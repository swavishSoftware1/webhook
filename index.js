const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
// const Lead = require('./models/Lead'); // MongoDB model for storing leads

const app = express();
app.use(bodyParser.json()); // Parse incoming request bodies as JSON

const VERIFY_TOKEN = "my_verify_token"; // Use this token to verify the webhook

// MongoDB Schema for Lead Storage
const leadSchema = new mongoose.Schema({
  formId: String,
  leadgenId: String,
  fullName: String,
  email: String,
  phoneNumber: String,
  createdTime: Date,
});
const Lead = mongoose.model("Lead", leadSchema);

// 1. Verify the Webhook when Meta sends a GET request
app.get("/webhook", (req, res) => {
  console.log("get hit");
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === "my_verify_token") {
    console.log("challenge accepted")
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Verification failed");
  }
});
console.log("hii");
// 2. Listen for POST requests with lead data from Meta
app.post("/webhook", async (req, res) => {
  console.log("hit post");
  const body = req.body;
  console.log("body", body);

  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      entry.changes.forEach(async (change) => {
        if (change.field === "leadgen") {
          const formId = change.value.form_id;
          const leadgenId = change.value.leadgen_id;

          // Fetch lead data using the Meta API
          try {
            const leadData = await getLeadData(leadgenId);

            // Save lead data to MongoDB
            const newLead = new Lead({
              formId: formId,
              leadgenId: leadgenId,
              fullName:
                leadData.field_data.find((field) => field.name === "full_name")
                  ?.values[0] || "N/A",
              email:
                leadData.field_data.find((field) => field.name === "email")
                  ?.values[0] || "N/A",
              phoneNumber:
                leadData.field_data.find(
                  (field) => field.name === "phone_number"
                )?.values[0] || "N/A",
              createdTime: leadData.created_time,
            });

            await newLead.save();
            console.log("New lead added:", newLead);
          } catch (error) {
            console.error(
              "Error fetching lead data:",
              error.response ? error.response.data : error.message
            );
          }
        }
      });
    });

    // Respond with a 200 OK to acknowledge receipt
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.status(404).send("Nothing Found");
  }
});

// Function to Fetch Lead Data from Meta Using Lead ID
const getLeadData = async (leadgenId) => {
  console.log("leadgenId", leadgenId);
  const accessToken =
    "EAAHEnds0DWQBO6rU2aKa8tJyO7MZBrDDwpZCSAv6PETt09Irxiq3C4YF4a4aTRgL5uwk5aE92WUxSZCgTacWZCvVOOx0wjxdOZAn0yyrNf5aoQH4prYqJOe77Y91QdTAP0SB8YforZANF3Bumd24uuHLXNgeJIuxZC7J87HZAGfzEoGkaOSKFQ1lmmZAT";
  const response = await axios.get(
    `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${accessToken}`
  );
  return response.data;
};

// MongoDB Connection and Start Server
// mongoose
//   .connect('mongodb+srv://Kashif:Kashif2023@cluster0.bkcuqkh.mongodb.net/webhook', { useNewUrlParser: true, useUnifiedTopology: true })
//   .then(() => {
//     console.log('Connected to MongoDB');
//     app.listen(5000, () => console.log('Server is running on port 5000'));
//   })
//   .catch((err) => console.error('Failed to connect to MongoDB:', err));

app.listen(5000, () => console.log("Server is running on port 5000"));
