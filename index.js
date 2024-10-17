const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.json()); // Parse incoming request bodies as JSON

const VERIFY_TOKEN = "my_verify_token"; // Token to verify the webhook

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
  console.log("GET request received for webhook verification");
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verification successful, challenge accepted.");
    res.status(200).send(challenge);
  } else {
    console.log("Webhook verification failed.");
    res.status(403).send("Verification failed");
  }
});

console.log("Server initialized...");

// 2. Listen for POST requests with lead data from Meta
app.post("/webhook", async (req, res) => {
  console.log("POST request received for webhook");

  // Log the entire body of the request for debugging
  const body = req.body;
  console.log("Full body received:", JSON.stringify(body, null, 2));

  if (body.object === "page") {
    // Iterate through each entry in the request
    body.entry.forEach(async (entry) => {
      console.log("Entry received:", JSON.stringify(entry, null, 2));

      entry.changes.forEach(async (change) => {
        console.log("Change detected:", JSON.stringify(change, null, 2));

        if (change.field === "leadgen") {
          const formId = change.value.form_id;
          const leadgenId = change.value.leadgen_id;
          console.log(`Form ID: ${formId}, Leadgen ID: ${leadgenId}`);

          // Fetch lead data using the Meta API
          try {
            const leadData = await getLeadData(leadgenId);
            console.log("Lead data fetched from Meta:", JSON.stringify(leadData, null, 2));

            // Save lead data to MongoDB
            const newLead = new Lead({
              formId: formId,
              leadgenId: leadgenId,
              fullName:
                leadData.field_data.find((field) => field.name === "full_name")?.values[0] || "N/A",
              email:
                leadData.field_data.find((field) => field.name === "email")?.values[0] || "N/A",
              phoneNumber:
                leadData.field_data.find((field) => field.name === "phone_number")?.values[0] || "N/A",
              createdTime: leadData.created_time,
            });

            await newLead.save();
            console.log("New lead added to MongoDB:", JSON.stringify(newLead, null, 2));
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
    console.log("Request received, but no page object was found.");
    res.status(404).send("Nothing Found");
  }
});

// Function to Fetch Lead Data from Meta Using Lead ID
const getLeadData = async (leadgenId) => {
  console.log("Fetching lead data for Leadgen ID:", leadgenId);
  const accessToken =
    "EAAHUxwZBQdZBQBO8UPHWogLz6LqPpbLBpwpPDwK2eEN50Gc0dCbn7YJ4VuodU3piTkhFKdS0nT5mLij2KFfKiOLm8KvMN3anKNZB1Fx5dCQK9k43lDEJs9fqQ0VdUh0gZBwGknhYdlnOP98I4rdW5LOjYZAt6gKAwVGbYUjvzprYJBXZAntd0qGIW1OVDeIZC6hBRc8UCSUtN055tsRxM44SlAbh8UZD";
  const response = await axios.get(
    `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${accessToken}`
  );
  return response.data;
};

// Start the server
app.listen(5000, () => console.log("Server is running on port 5000"));
