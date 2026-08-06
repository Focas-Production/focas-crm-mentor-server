const { z } = require("zod");

const phoneNumberSchema = z.object({
  phoneNumber: z.string()
    .min(10, "Phone number must be at least 10 digits")
    .max(15, "Phone number must be at most 15 digits")
    .regex(/^[+]?[0-9]+$/, "Phone number must contain only digits and optional +")
});

const personalDetailsSchema = z.object({
  city: z.string().min(1, "City is required"),
  caLevel: z.enum(['CA Foundation', 'CA Intermediate', 'CA Final'], {
    errorMap: () => ({ message: "Please select a valid CA exam level" })
  })
});

const examDateSchema = z.object({
  examDate: z.string().datetime().refine(
    (date) => new Date(date) > new Date(),
    { message: "Exam date must be in the future" }
  )
});

const completeProfileSchema = z.object({
  phoneNumber: z.string().min(10).max(15).regex(/^[+]?[0-9]+$/),
  city: z.string().min(1),
  caLevel: z.enum(['CA Foundation', 'CA Intermediate', 'CA Final']),
  examDate: z.string().datetime().refine(
    (date) => new Date(date) > new Date(),
    { message: "Exam date must be in the future" }
  )
});

// In zodSchemas/profileSchema.js
const otpSchema = z.object({
  phoneNumber: z.string()
    .min(10, "Phone number must be at least 10 digits")
    .regex(/^[+]?[0-9]+$/, "Invalid phone number format"),
  otp: z.string()
    .length(6, 'OTP must be 6 digits')
});


module.exports = { 
  phoneNumberSchema, 
  personalDetailsSchema, 
  examDateSchema, 
  completeProfileSchema,
  otpSchema
};
