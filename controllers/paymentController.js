// controllers/paymentController.js
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Subscription = require("../models/Subscription");
const User = require("../models/User");

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Razorpay order
exports.createOrder = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Check if user already has an active subscription
    const existingSubscription = await Subscription.findOne({
      userId,
      status: "active",
      endDate: { $gt: new Date() },
    });

    if (existingSubscription && existingSubscription.plan === "pro") {
      return res.status(400).json({
        error: "Active subscription exists",
        message: "You already have an active Pro subscription",
      });
    }

    const shortReceipt = `rcpt_${userId.slice(-6)}_${Date.now()
      .toString()
      .slice(-5)}`;

    // Create Razorpay order
    const options = {
      amount: 19900, // Rs. 199 in paise (199 * 100)
      currency: "INR",
      receipt: shortReceipt,
      notes: {
        userId: userId,
        plan: "pro",
      },
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    res.status(500).json({
      error: "Failed to create order",
      message: error.message,
    });
  }
};

// Verify payment and activate subscription
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    const userId = req.user.userId;

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        error: "Invalid signature",
        message: "Payment verification failed",
      });
    }

    // Payment is valid, create subscription
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30); // 30 days from now

    const subscription = await Subscription.create({
      userId,
      plan: "pro",
      status: "active",
      startDate,
      endDate,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      amount: 199,
      currency: "INR",
      monthlyQueryLimit: 2000,
      queriesUsed: 0,
    });

    res.json({
      success: true,
      message: "Payment verified and subscription activated",
      subscription: {
        plan: subscription.plan,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        monthlyQueryLimit: subscription.monthlyQueryLimit,
      },
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({
      error: "Payment verification failed",
      message: error.message,
    });
  }
};

// Get subscription status
exports.getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Find active subscription
    const subscription = await Subscription.findOne({
      userId,
      status: "active",
      endDate: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.json({
        success: true,
        plan: "free",
        dailyLimit: 7,
        monthlyLimit: 70,
        isActive: false,
      });
    }

    res.json({
      success: true,
      plan: subscription.plan,
      monthlyLimit: subscription.monthlyQueryLimit,
      queriesUsed: subscription.queriesUsed,
      queriesRemaining:
        subscription.monthlyQueryLimit - subscription.queriesUsed,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      isActive: subscription.isValid(),
      daysRemaining: Math.ceil(
        (subscription.endDate - new Date()) / (1000 * 60 * 60 * 24)
      ),
    });
  } catch (error) {
    console.error("Error fetching subscription status:", error);
    res.status(500).json({
      error: "Failed to fetch subscription status",
      message: error.message,
    });
  }
};

// Get payment history
exports.getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.userId;

    const subscriptions = await Subscription.find({ userId })
      .sort({ createdAt: -1 })
      .select(
        "plan amount currency startDate endDate status razorpayPaymentId createdAt"
      );

    res.json({
      success: true,
      history: subscriptions,
    });
  } catch (error) {
    console.error("Error fetching payment history:", error);
    res.status(500).json({
      error: "Failed to fetch payment history",
      message: error.message,
    });
  }
};
