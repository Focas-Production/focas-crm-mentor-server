require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;

const run = async () => {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  await mongoose.connect(MONGO_URI, {
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
  });

  const db = mongoose.connection.db;
  const users = db.collection("users");

  const indexes = await users.indexes();
  const phoneIndex = indexes.find((idx) => idx.name === "phoneNumber_1");

  if (phoneIndex) {
    await users.dropIndex("phoneNumber_1");
    console.log("Dropped index: phoneNumber_1");
  } else {
    console.log("Index phoneNumber_1 not found, skipping drop.");
  }

  const unsetResult = await users.updateMany(
    { phoneNumber: null },
    { $unset: { phoneNumber: "" } }
  );
  console.log(
    `Unset phoneNumber from ${unsetResult.modifiedCount} document(s).`
  );

  await users.createIndex(
    { phoneNumber: 1 },
    {
      unique: true,
      partialFilterExpression: { phoneNumber: { $type: "string" } },
      name: "phoneNumber_1",
    }
  );
  console.log("Created partial unique index: phoneNumber_1");
};

run()
  .then(async () => {
    await mongoose.connection.close();
    console.log("Migration complete.");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Migration failed:", err);
    try {
      await mongoose.connection.close();
    } catch (closeErr) {
      console.error("Failed to close connection:", closeErr);
    }
    process.exit(1);
  });
