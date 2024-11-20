const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json()); // Parse incoming request bodies as JSON

const VERIFY_TOKEN = "my_verify_token"; // Token to verify the webhook
const USER_ACCESS_TOKEN =
  "EAAHEnds0DWQBO8Tr7jyEqPLCZBxnP2hkoepm5ODZAnY0mGXRenneSyIo1gj3fWiDxZCypL9j1ynZC01kUFoaDFdmHNqMiM0Gm8mpL1hQfGHHkThNbNU8Lz7DfdXkX8SgQR8kzzx6OKMFNmHnA2CtagUnj9Vp09nmX5GaB435E5dYK7Qcm14i36eZBzMTeKWW2RsBGt5xLtJbRzur2mAZDZD"; // Replace with your User Access Token

// 1. Verify the Webhook when Meta sends a GET request
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    res.status(200).send(challenge);
  } else {
    console.error("Webhook verification failed.");
    res.status(403).send("Verification failed");
  }
});

// 2. Listen for POST requests from Meta
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    console.log("Webhook event received for 'page' object.");
    for (const entry of body.entry) {
      console.log(`Processing entry: ${JSON.stringify(entry, null, 2)}`);
      for (const change of entry.changes) {
        if (change.field === "leadgen") {
          const { leadgen_id: leadgenId, form_id: formId, page_id: pageId } = change.value;

          console.log(`Received leadgen ID: ${leadgenId} from Page ID: ${pageId}`);

          try {
            const leadData = await getLeadData(leadgenId);
            const pageDetails = await getPageDetails(pageId);

            console.log("Lead Data Fetched:");
            console.log(JSON.stringify(leadData, null, 2));

            console.log("Page Details:");
            console.log(JSON.stringify(pageDetails, null, 2));

            // Log the processed lead data
            const processedLead = {
              formId,
              leadgenId,
              pageId,
              pageName: pageDetails.name,
              fullName:
                leadData.field_data.find((field) => field.name === "full_name")?.values[0] || "N/A",
              email:
                leadData.field_data.find((field) => field.name === "email")?.values[0] || "N/A",
              phoneNumber:
                leadData.field_data.find((field) => field.name === "phone_number")?.values[0] || "N/A",
              createdTime: leadData.created_time,
            };

            console.log("Processed Lead Data:", JSON.stringify(processedLead, null, 2));
          } catch (error) {
            console.error("Error fetching lead data:", error.response?.data || error.message);
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    console.error("Webhook event object is not 'page'. Ignoring.");
    res.status(404).send("Nothing Found");
  }
});

// Function to Fetch Lead Data by Lead ID
const getLeadData = async (leadgenId) => {
  try {
    console.log(`Fetching lead data for Leadgen ID: ${leadgenId}`);
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${USER_ACCESS_TOKEN}`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching lead data:", error.response?.data || error.message);
    throw new Error("Failed to fetch lead data.");
  }
};

// Function to Fetch Page Details
const getPageDetails = async (pageId) => {
  try {
    console.log(`Fetching details for Page ID: ${pageId}`);
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${pageId}?fields=name&access_token=${USER_ACCESS_TOKEN}`
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching page details:", error.response?.data || error.message);
    throw new Error("Failed to fetch page details.");
  }
};

// Fetch All Pages and Their Leads
const fetchAllLeads = async () => {
  try {
    console.log("Fetching all pages linked to the user.");
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts?fields=id,name&access_token=${USER_ACCESS_TOKEN}`
    );
    const pages = pagesResponse.data.data;

    console.log(`Found ${pages.length} pages. Fetching leads...`);

    for (const page of pages) {
      console.log(`Fetching leads for Page: ${page.name} (ID: ${page.id})`);

      // Fetch leadgen forms for the Page
      const formsResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}/leadgen_forms?access_token=${USER_ACCESS_TOKEN}`
      );
      const forms = formsResponse.data.data;

      console.log(`Found ${forms.length} forms for Page: ${page.name}.`);

      for (const form of forms) {
        console.log(`Fetching leads for Form ID: ${form.id}`);

        // Fetch leads for the form
        const leadsResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${form.id}/leads?access_token=${USER_ACCESS_TOKEN}`
        );
        const leads = leadsResponse.data.data;

        console.log(`Found ${leads.length} leads for Form ID: ${form.id}.`);

        for (const lead of leads) {
          console.log("Fetched Lead Data:");
          console.log(JSON.stringify(lead, null, 2));
        }
      }
    }
  } catch (error) {
    console.error("Error fetching pages or leads:", error.response?.data || error.message);
  }
};

// Start the Server
app.listen(5000, () => {
  console.log("Server is running on port 5000");
  // Optionally, fetch all leads when the server starts
  fetchAllLeads();
});
