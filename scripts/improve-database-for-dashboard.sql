-- ============================================
-- Улучшения базы данных для дашборда Lovable
-- ============================================
-- Этот скрипт создает индексы, view и материализованные view
-- для оптимизации запросов в дашборде
-- ============================================

-- ============================================
-- 1. ИНДЕКСЫ ДЛЯ БЫСТРЫХ ЗАПРОСОВ
-- ============================================

-- Индексы для временных запросов
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_ref_clicks_created_at ON ref_clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_ref_clicks_first_seen_at ON ref_clicks(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_ref_matches_matched_at ON ref_matches(matched_at);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_created_at ON ref_rewards(created_at);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_granted_at ON ref_rewards(granted_at);
CREATE INDEX IF NOT EXISTS idx_giftcard_jobs_created_at ON giftcard_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_giftcard_runs_created_at ON giftcard_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_created_at ON notification_events(created_at);

-- Индексы для фильтрации по статусам
CREATE INDEX IF NOT EXISTS idx_ref_links_status ON ref_links(status);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_status ON ref_rewards(status);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_type ON ref_rewards(type);
CREATE INDEX IF NOT EXISTS idx_giftcard_jobs_status ON giftcard_jobs(status);
CREATE INDEX IF NOT EXISTS idx_giftcard_runs_status ON giftcard_runs(status);
CREATE INDEX IF NOT EXISTS idx_notification_events_status ON notification_events(status);
CREATE INDEX IF NOT EXISTS idx_notification_events_channel ON notification_events(channel);

-- Индексы для связи между таблицами
CREATE INDEX IF NOT EXISTS idx_ref_clicks_ref_code ON ref_clicks(ref_code);
CREATE INDEX IF NOT EXISTS idx_ref_clicks_customer_id ON ref_clicks(customer_id);
CREATE INDEX IF NOT EXISTS idx_ref_clicks_matched ON ref_clicks(matched);
CREATE INDEX IF NOT EXISTS idx_ref_matches_ref_code ON ref_matches(ref_code);
CREATE INDEX IF NOT EXISTS idx_ref_matches_customer_id ON ref_matches(customer_id);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_referrer_customer_id ON ref_rewards(referrer_customer_id);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_friend_customer_id ON ref_rewards(friend_customer_id);
CREATE INDEX IF NOT EXISTS idx_ref_rewards_ref_match_id ON ref_rewards(ref_match_id);

-- Индексы для square_existing_clients (legacy)
CREATE INDEX IF NOT EXISTS idx_square_clients_created_at ON square_existing_clients(created_at);
CREATE INDEX IF NOT EXISTS idx_square_clients_activated_referrer ON square_existing_clients(activated_as_referrer);

-- ============================================
-- 2. VIEW ДЛЯ ОБЪЕДИНЕНИЯ ДАННЫХ
-- ============================================

-- Объединенный view для клиентов (новая + legacy система)
CREATE OR REPLACE VIEW unified_customers AS
SELECT 
  COALESCE(c.id, sec.square_customer_id) as id,
  COALESCE(c.square_customer_id, sec.square_customer_id) as square_customer_id,
  COALESCE(c.email, sec.email_address) as email,
  COALESCE(c.phone_e164, sec.phone_number) as phone,
  COALESCE(c.full_name, 
    CASE 
      WHEN sec.given_name IS NOT NULL OR sec.family_name IS NOT NULL 
      THEN CONCAT(COALESCE(sec.given_name, ''), ' ', COALESCE(sec.family_name, ''))
      ELSE NULL
    END
  ) as full_name,
  COALESCE(c.first_name, sec.given_name) as first_name,
  COALESCE(c.last_name, sec.family_name) as last_name,
  COALESCE(c.created_at, sec.created_at) as created_at,
  COALESCE(c.first_paid_seen, sec.first_payment_completed, false) as first_paid,
  COALESCE(sec.total_referrals, 0) as total_referrals,
  COALESCE(sec.total_rewards, 0) as total_rewards,
  COALESCE(sec.activated_as_referrer, false) as activated_as_referrer,
  CASE 
    WHEN c.id IS NOT NULL THEN 'new_system'
    WHEN sec.square_customer_id IS NOT NULL THEN 'legacy_system'
    ELSE 'unknown'
  END as source_system
FROM customers c
FULL OUTER JOIN square_existing_clients sec 
  ON c.square_customer_id = sec.square_customer_id;

-- View для статистики реферальных ссылок
CREATE OR REPLACE VIEW referral_link_stats AS
SELECT 
  rl.id,
  rl.ref_code,
  rl.status,
  rl.customer_id,
  rl.created_at,
  COUNT(DISTINCT rc.id) as total_clicks,
  COUNT(DISTINCT CASE WHEN rc.matched THEN rc.id END) as matched_clicks,
  COUNT(DISTINCT rm.id) as total_matches,
  COUNT(DISTINCT rr.id) as total_rewards,
  SUM(CASE WHEN rr.status = 'GRANTED' THEN rr.amount ELSE 0 END) as total_reward_amount
FROM ref_links rl
LEFT JOIN ref_clicks rc ON rc.ref_code = rl.ref_code
LEFT JOIN ref_matches rm ON rm.ref_code = rl.ref_code
LEFT JOIN ref_rewards rr ON rr.ref_match_id = rm.id
GROUP BY rl.id, rl.ref_code, rl.status, rl.customer_id, rl.created_at;

-- ============================================
-- 3. МАТЕРИАЛИЗОВАННЫЕ VIEW ДЛЯ АГРЕГАЦИИ
-- ============================================

-- Статистика реферальной программы по дням
CREATE MATERIALIZED VIEW IF NOT EXISTS referral_daily_stats AS
SELECT 
  DATE(rc.created_at) as date,
  COUNT(DISTINCT rc.id) as total_clicks,
  COUNT(DISTINCT CASE WHEN rc.matched THEN rc.id END) as matched_clicks,
  COUNT(DISTINCT rm.id) as total_matches,
  COUNT(DISTINCT rr.id) as total_rewards,
  COUNT(DISTINCT CASE WHEN rr.status = 'GRANTED' THEN rr.id END) as granted_rewards,
  SUM(CASE WHEN rr.status = 'GRANTED' THEN rr.amount ELSE 0 END) as total_reward_amount,
  COUNT(DISTINCT rc.ref_code) as unique_ref_codes,
  COUNT(DISTINCT rc.customer_id) as unique_clickers
FROM ref_clicks rc
LEFT JOIN ref_matches rm ON rm.ref_code = rc.ref_code
LEFT JOIN ref_rewards rr ON rr.ref_match_id = rm.id
GROUP BY DATE(rc.created_at);

-- Индекс для быстрого поиска по дате
CREATE INDEX IF NOT EXISTS idx_referral_daily_stats_date ON referral_daily_stats(date);

-- Статистика клиентов по дням
CREATE MATERIALIZED VIEW IF NOT EXISTS customer_daily_stats AS
SELECT 
  DATE(COALESCE(c.created_at, sec.created_at)) as date,
  COUNT(DISTINCT COALESCE(c.id, sec.square_customer_id)) as new_customers,
  COUNT(DISTINCT CASE 
    WHEN COALESCE(c.first_paid_seen, sec.first_payment_completed, false) 
    THEN COALESCE(c.id, sec.square_customer_id) 
  END) as first_paid_customers,
  COUNT(DISTINCT rl.id) as new_referrers,
  COUNT(DISTINCT CASE 
    WHEN sec.activated_as_referrer = true 
    THEN sec.square_customer_id 
  END) as activated_referrers
FROM customers c
FULL OUTER JOIN square_existing_clients sec 
  ON c.square_customer_id = sec.square_customer_id
LEFT JOIN ref_links rl ON rl.customer_id = c.id AND rl.status = 'ACTIVE'
GROUP BY DATE(COALESCE(c.created_at, sec.created_at));

-- Индекс для быстрого поиска по дате
CREATE INDEX IF NOT EXISTS idx_customer_daily_stats_date ON customer_daily_stats(date);

-- Статистика задач подарочных карт по дням
CREATE MATERIALIZED VIEW IF NOT EXISTS giftcard_daily_stats AS
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_jobs,
  COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued_jobs,
  COUNT(CASE WHEN status = 'running' THEN 1 END) as running_jobs,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
  COUNT(CASE WHEN status = 'error' THEN 1 END) as error_jobs,
  AVG(attempts) as avg_attempts,
  COUNT(CASE WHEN attempts >= max_attempts THEN 1 END) as maxed_attempts_jobs
FROM giftcard_jobs
GROUP BY DATE(created_at);

-- Индекс для быстрого поиска по дате
CREATE INDEX IF NOT EXISTS idx_giftcard_daily_stats_date ON giftcard_daily_stats(date);

-- Статистика уведомлений по дням
CREATE MATERIALIZED VIEW IF NOT EXISTS notification_daily_stats AS
SELECT 
  DATE(created_at) as date,
  channel,
  COUNT(*) as total_notifications,
  COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
  COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
  COUNT(CASE WHEN status = 'bounced' THEN 1 END) as bounced,
  COUNT(DISTINCT template_type) as unique_template_types
FROM notification_events
GROUP BY DATE(created_at), channel;

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_notification_daily_stats_date ON notification_daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_notification_daily_stats_channel ON notification_daily_stats(channel);

-- ============================================
-- 4. ФУНКЦИИ ДЛЯ ОБНОВЛЕНИЯ МАТЕРИАЛИЗОВАННЫХ VIEW
-- ============================================

-- Функция для обновления всех материализованных view
CREATE OR REPLACE FUNCTION refresh_all_dashboard_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY referral_daily_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY customer_daily_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY giftcard_daily_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY notification_daily_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. ПОЛЕЗНЫЕ ЗАПРОСЫ ДЛЯ ДАШБОРДА
-- ============================================

-- Общая статистика реферальной программы
-- (можно использовать как view)
CREATE OR REPLACE VIEW referral_overview_stats AS
SELECT 
  (SELECT COUNT(*) FROM customers) as total_customers_new,
  (SELECT COUNT(*) FROM square_existing_clients) as total_customers_legacy,
  (SELECT COUNT(*) FROM unified_customers) as total_customers_unified,
  (SELECT COUNT(*) FROM ref_links WHERE status = 'ACTIVE') as active_referrers,
  (SELECT COUNT(*) FROM ref_clicks) as total_clicks,
  (SELECT COUNT(*) FROM ref_clicks WHERE matched = true) as matched_clicks,
  (SELECT COUNT(*) FROM ref_matches) as total_matches,
  (SELECT COUNT(*) FROM ref_rewards) as total_rewards,
  (SELECT COUNT(*) FROM ref_rewards WHERE status = 'GRANTED') as granted_rewards,
  (SELECT COUNT(*) FROM ref_rewards WHERE status = 'PENDING') as pending_rewards,
  (SELECT SUM(amount) FROM ref_rewards WHERE status = 'GRANTED') as total_reward_amount,
  (SELECT AVG(amount) FROM ref_rewards WHERE status = 'GRANTED') as avg_reward_amount;

-- Топ реферальные коды
CREATE OR REPLACE VIEW top_referral_codes AS
SELECT 
  rc.ref_code,
  COUNT(DISTINCT rc.id) as clicks,
  COUNT(DISTINCT CASE WHEN rc.matched THEN rc.id END) as matched_clicks,
  COUNT(DISTINCT rm.id) as matches,
  COUNT(DISTINCT rr.id) as rewards,
  SUM(CASE WHEN rr.status = 'GRANTED' THEN rr.amount ELSE 0 END) as reward_amount,
  ROUND(
    COUNT(DISTINCT CASE WHEN rc.matched THEN rc.id END)::numeric / 
    NULLIF(COUNT(DISTINCT rc.id), 0) * 100, 
    2
  ) as conversion_rate
FROM ref_clicks rc
LEFT JOIN ref_matches rm ON rm.ref_code = rc.ref_code
LEFT JOIN ref_rewards rr ON rr.ref_match_id = rm.id
GROUP BY rc.ref_code
HAVING COUNT(DISTINCT rc.id) > 0
ORDER BY clicks DESC;

-- ============================================
-- КОММЕНТАРИИ
-- ============================================

-- После выполнения скрипта:
-- 1. Материализованные view нужно обновлять периодически:
--    SELECT refresh_all_dashboard_views();
--
-- 2. Можно настроить cron job для автоматического обновления:
--    Например, каждый час или раз в день
--
-- 3. Для обновления конкретного view:
--    REFRESH MATERIALIZED VIEW CONCURRENTLY referral_daily_stats;
--
-- 4. В Lovable можно использовать:
--    - unified_customers - для работы с клиентами
--    - referral_daily_stats - для временных графиков
--    - referral_overview_stats - для общей статистики
--    - top_referral_codes - для топ реферальных кодов





