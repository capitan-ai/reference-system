# 📧 Gmail Email Marketing Setup Guide

## 🔧 **Environment Variables Setup**

Add these to your `.env` file and Vercel environment:

```bash
# Gmail SMTP Configuration
BUSINESS_EMAIL=hello@zorinanailstudio.com
GMAIL_APP_PASSWORD=your_16_character_app_password
TEST_EMAIL=your-test-email@gmail.com
```

## 🔐 **Gmail App Password Setup**

### **Step 1: Enable 2-Factor Authentication**
1. Go to [Google Account Settings](https://myaccount.google.com/)
2. Sign in with your business Gmail
3. Go to **Security** → **2-Step Verification**
4. Enable 2-factor authentication if not already enabled

### **Step 2: Generate App Password**
1. Go to **Security** → **App passwords**
2. Select **Mail** and **Other (custom name)**
3. Enter **"Referral System"** as the name
4. Copy the 16-character password (e.g., `abcd efgh ijkl mnop`)
5. Add this to your environment variables as `GMAIL_APP_PASSWORD`

## 📧 **Email Templates**

### **Referral Code Email:**
- **Subject:** "🎁 Your Referral Code - Earn $10 for Each Friend!"
- **Content:** Professional HTML template with referral code and instructions
- **Features:** Responsive design, clear call-to-action, business branding

### **Marketing Email:**
- **Subject:** "💅 Special Offer - Book Your Next Appointment!"
- **Content:** Promotional email with special offers
- **Features:** Service highlights, location info, booking button

## 🚀 **Usage Commands**

### **Test Email Service:**
```bash
node scripts/email-marketing.js test
```
This sends a test email to verify your Gmail setup.

### **Send Marketing Emails:**
```bash
node scripts/email-marketing.js marketing
```
Sends promotional emails to all customers with email addresses.

### **Send Referral Codes:**
```bash
node scripts/email-marketing.js referral
```
Sends referral codes to customers who have been activated as referrers.

## 📊 **Email Features**

### **Professional Templates:**
- ✅ **Responsive HTML design**
- ✅ **Mobile-friendly layouts**
- ✅ **Brand colors and styling**
- ✅ **Clear call-to-action buttons**
- ✅ **Business information included**

### **Email Tracking:**
- ✅ **Send status tracking**
- ✅ **Error logging**
- ✅ **Bulk email processing**
- ✅ **Rate limiting protection**

### **Content Management:**
- ✅ **Dynamic customer names**
- ✅ **Personalized referral codes**
- ✅ **Custom referral URLs**
- ✅ **Service highlights**

## 🔄 **Integration with Referral System**

### **Automatic Email Sending:**
1. **Generate referral codes** → Automatically send emails
2. **Customer activation** → Send welcome email
3. **Marketing campaigns** → Send promotional emails
4. **Referral success** → Send confirmation emails

### **Email Database Tracking:**
- `email_sent_at` - Timestamp of last email sent
- `activated_as_referrer` - Whether customer received referral code
- `personal_code` - Their unique referral code

## 📈 **Email Marketing Strategy**

### **Campaign Types:**
1. **Welcome Series** - New customer onboarding
2. **Referral Program** - Referral code distribution
3. **Promotional** - Special offers and discounts
4. **Re-engagement** - Win back inactive customers
5. **Seasonal** - Holiday and special event promotions

### **Best Practices:**
- ✅ **Personalize subject lines**
- ✅ **Use customer names**
- ✅ **Include clear call-to-actions**
- ✅ **Mobile-optimized templates**
- ✅ **Professional branding**
- ✅ **Comply with email regulations**

## 🛠️ **Customization Options**

### **Email Content:**
- **Business name:** Zorina Nail Studio
- **Locations:** 
  - 2266 Union St, San Francisco, CA
  - 550 Pacific Ave, San Francisco, CA
- **Phone:** (415) 555-0123
- **Website:** www.zorinanailstudio.com
- **Services:** Manicures, Pedicures, Nail Art, etc.

### **Branding:**
- **Colors:** Custom gradient headers
- **Fonts:** Arial, sans-serif
- **Logo:** Add your business logo
- **Style:** Professional and modern

## 🚨 **Important Notes**

1. **Gmail Limits:** 500 emails per day for free accounts
2. **App Password:** Use 16-character app password, not regular password
3. **Rate Limiting:** 1-second delay between emails to avoid spam detection
4. **Testing:** Always test with your own email first
5. **Compliance:** Follow CAN-SPAM and GDPR regulations

## 🎯 **Next Steps**

1. **Set up Gmail app password**
2. **Add environment variables**
3. **Test email service**
4. **Send referral codes to customers**
5. **Launch marketing campaigns**

**Your email marketing system is ready!** 📧✨
