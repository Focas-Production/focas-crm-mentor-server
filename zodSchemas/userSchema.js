const { z } = require("zod");

const phoneNumberField = z
  .string()
  .min(10, "Phone number must be at least 10 digits")
  .max(15, "Phone number must be at most 15 digits")
  .regex(/^[+]?[0-9]+$/, "Phone number must contain only digits and optional +");

const userSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  email: z.string().email("Invalid email"),
  name: z.string().min(1, "Name is required"),
  createdAt: z.date().optional(),
  lastLogin: z.date().optional(),
});

// For updating user (only name allowed for now)
const updateUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

// For mock login (needs email + name)
const mockLoginSchema = z.object({
  email: z.string().email("Invalid email"),
  name: z.string().min(1, "Name is required"),
});

const whatsappSignupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phoneNumber: phoneNumberField,
});

const phoneSignupOtpSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phoneNumber: phoneNumberField,
});

const phoneLoginOtpSchema = z.object({
  phoneNumber: phoneNumberField,
});

const phoneVerifyOtpSchema = z.object({
  phoneNumber: phoneNumberField,
  otp: z.string().length(6, "OTP must be 6 digits"),
});

module.exports = {
  userSchema,
  updateUserSchema,
  mockLoginSchema,
  whatsappSignupSchema,
  phoneSignupOtpSchema,
  phoneLoginOtpSchema,
  phoneVerifyOtpSchema,
};