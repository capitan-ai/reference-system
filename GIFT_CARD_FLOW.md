# Gift Card Flow - Referral System

## Overview
This document explains how gift cards are created and loaded for both friends and referrers.

## Flow Details

### 1. Friend Books with Referral Code (booking.created)

**Event:** Customer books a service using a referral code

**Actions:**
- Friend gets a $10 gift card IMMEDIATELY when booking
- Gift card is created using `createGiftCard(customerId, name, 1000, false)`
  - If `square_existing_clients` already stores `gift_card_order_id` + `gift_card_line_item_uid`, the system attempts order-based activation first (Square eGift flow).
  - Falls back to owner-funded activation (`OWNER_FUNDED` / `ADJUST_INCREMENT`) if no paid order metadata is available.
- Gift card metadata (`gift_card_order_id`, `gift_card_line_item_uid`, `gift_card_delivery_channel`, `gift_card_activation_url`, `gift_card_pass_kit_url`, `gift_card_digital_email`) is saved to the customer record.
- Gift card is linked to the Square customer profile.
- `got_signup_bonus = TRUE` is set.
- Customer receives the “Gift Card Delivery” email with the GAN, QR code, and wallet links when present.

**Result:** Friend has $10 gift card ready to use

---

### 2. Friend Pays (payment.updated - First Payment)

**Event:** Friend completes their first payment

**Actions:**
- Check if `first_payment_completed = FALSE` (first payment)
- Find referrer who provided the referral code
- **If referrer doesn't have `gift_card_id`:**
  - Create NEW gift card for referrer with $10 (tries eGift order activation first, then owner-funded fallback)
  - Persist gift card metadata and send delivery email to referrer
- **If referrer already has `gift_card_id`:**
  - Load $10 onto EXISTING gift card using `loadGiftCard()`
  - Uses Gift Card Activities API with `ADJUST_INCREMENT` activity type
-  - Refresh stored metadata and email the referrer with the new balance
- Update referrer's stats:
  - `total_referrals += 1`
  - `total_rewards += 1000` ($10)
- Send referral code email to the new customer (now a referrer)
- Set `first_payment_completed = TRUE` for the customer

**Result:** 
- Referrer gets $10 on their gift card (or new card if first time)
- Customer becomes a referrer with their own referral code

---

### 3. New Customer Becomes Referrer (sendReferralCodeToNewClient)

**Event:** After first payment, customer receives their referral code

**Actions:**
- Generate/use existing `personal_code` (referral code in name+ID format)
- **If customer already has `gift_card_id`** (from using referral code as friend):
  - Keep the existing gift card
  - This card will accumulate both friend rewards and referrer rewards
- **If customer doesn't have `gift_card_id`:**
  - Create new referrer gift card with $0 balance
  - This will be used for future referrer rewards
- Link gift card to customer profile
- Update database:
  - `activated_as_referrer = TRUE`
  - `personal_code = referralCode`
  - `gift_card_id = giftCardId`
  - `referral_email_sent = TRUE`
- Send email with referral code

**Result:** Customer now has referral code and one gift card for accumulating rewards

---

## Key Points

### Referrers - ONE Gift Card That Gets Refilled ✅

- Each referrer has **ONE gift card** stored in `gift_card_id` field
- When a friend pays, $10 is **loaded onto the existing gift card** using:
  - Gift Card Activities API
  - Activity type: `ADJUST_INCREMENT`
  - This adds money to the existing balance (doesn't create new card)
- The same gift card can accumulate rewards from multiple referrals
- Gift card balance grows: $10 → $20 → $30 → etc.

### Friends - Get Their Own Gift Card ✅

- Each friend gets their **own separate $10 gift card** when booking
- This is different from the referrer's gift card
- Friend gift card is used for their own purchases
- If the friend later becomes a referrer, they may:
  - Keep their friend gift card (if they have one)
  - Or get a new referrer gift card if they don't have one

### Gift Card Loading ✅

- Uses Square's **Gift Card Activities API** (`create-gift-card-activity`)
- Activity type: `ADJUST_INCREMENT`
- Reason: `REFERRAL_REWARD`
- This is the proper way to add money to existing gift cards according to Square API
- After every activation/load we refresh the Square card and persist:
  - `gift_card_delivery_channel`
  - `gift_card_activation_url`
  - `gift_card_pass_kit_url`
  - `gift_card_digital_email`
- Gift card delivery emails are triggered automatically whenever value is issued or added.

### Gift Card Emails ✅

- Delivery email template shares styling with the referral mailer and includes GAN, QR, balance, and wallet buttons.
- Works for both owner-funded and eGift activations; hides wallet buttons gracefully when Square did not return URLs.
- Reminder emails can reuse the same template by toggling the `isReminder` flag.

---

## Example Flow

### Scenario: Customer A refers Customer B, Customer B refers Customer C

1. **Customer B books with Customer A's code:**
   - Customer B gets $10 friend gift card (gift_card_id: `gftc:123`)

2. **Customer B pays:**
   - Customer A gets $10 loaded onto their gift card (or creates new one if first time)
   - Customer B becomes referrer, gets referral code

3. **Customer C books with Customer B's code:**
   - Customer C gets $10 friend gift card (gift_card_id: `gftc:456`)

4. **Customer C pays:**
   - Customer B gets $10 loaded onto their gift card (gftc:123) - **SAME CARD**
   - Balance: $10 → $20
   - Customer C becomes referrer

5. **Customer D books with Customer B's code:**
   - Customer D gets $10 friend gift card (gftc:789)

6. **Customer D pays:**
   - Customer B gets $10 loaded onto their gift card (gftc:123) - **SAME CARD**
   - Balance: $20 → $30

**Result:** Customer B has ONE gift card (gftc:123) with $30 balance from 3 referrals.

---

## API Methods Used

### Creating Gift Cards
- `giftCardsApi.createGiftCard()` - Creates new gift card
- `giftCardsApi.linkCustomerToGiftCard()` - Links card to customer profile

### Loading Gift Cards
- `giftCardActivitiesApi.createGiftCardActivity()` - Creates activity to add money
- Activity type: `ADJUST_INCREMENT`
- This adds money to existing gift card balance

---

## Database Fields

- `gift_card_id`: Stores the ONE Square gift card ID per customer
- `gift_card_order_id`: Latest Square order used for eGift activation (if any)
- `gift_card_line_item_uid`: Gift-card line item UID from the order payload
- `gift_card_delivery_channel`: `square_egift_order`, `owner_funded_activate`, or `owner_funded_adjust`
- `gift_card_activation_url`: Direct link to Square’s digital card experience
- `gift_card_pass_kit_url`: Apple/Google Wallet URL when returned by Square
- `gift_card_digital_email`: Recipient email reported by Square
- `total_referrals`: Count of referrals made
- `total_rewards`: Total rewards earned in cents
- `got_signup_bonus`: TRUE if customer received friend gift card
- `activated_as_referrer`: TRUE if customer is an active referrer

