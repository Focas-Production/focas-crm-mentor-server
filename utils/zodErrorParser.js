// backend/utils/zodErrorParser.js
const zodErrorParser = (zodError) => {
  return Object.keys(zodError.flatten().fieldErrors).map((field) => ({
    field,
    errors: zodError.flatten().fieldErrors[field],
  }));
};

module.exports = zodErrorParser;
