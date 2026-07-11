import mongoose from "mongoose";

const connectDB = async (retries = 5, delayMs = 3000): Promise<void> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI as string, {
        dbName: "HotPotato",
        serverSelectionTimeoutMS: 10000,
      });
      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

      // Log later drops (laptop sleep, ISP blip); the driver auto-reconnects.
      if (mongoose.connection.listenerCount("disconnected") === 0) {
        mongoose.connection.on("disconnected", () =>
          console.warn("⚠️  MongoDB disconnected — driver will retry"),
        );
        mongoose.connection.on("reconnected", () =>
          console.log("✅ MongoDB reconnected"),
        );
      }
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(
        `❌ MongoDB connect attempt ${attempt}/${retries} failed: ${msg}`,
      );
      if (attempt === retries) {
        console.error("❌ MongoDB connection error: giving up after retries");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
};

export default connectDB;
