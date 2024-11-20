const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json()); // Parse incoming request bodies as JSON

const VERIFY_TOKEN = "my_verify_token"; // Token to verify the webhook
const USER_ACCESS_TOKEN = "EAAHEnds0DWQBOZBwfP9h2hcOkD9KaIZCZCwtOKZByp5zoUlY3Mm2oJnALMLGAnZBVq7VR2jVraG94TMvM75rWQiZBjiHyfoHjLOglP9I43r816Nf1qB1M59UfUvAoOw0yzZAgQxPholfZBcvL3NwIi17b8Wb20EmyBkDKyoVr353urZCFcaMrhmeD1y1zffEzUcKk"; // Replace with your User Access Token

// 1. Verify the Webhook when Meta sends a GET request
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send("Verification failed");
  }
});

// 2. Listen for POST requests from Meta
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field === "leadgen") {
          const { leadgen_id: leadgenId, form_id: formId, page_id: pageId } = change.value;

          console.log(`Received leadgen ID: ${leadgenId} from Page ID: ${pageId}`);

          try {
            const leadData = await getLeadData(leadgenId);
            const pageDetails = await getPageDetails(pageId);

            // Log fetched data for debugging
            console.log("Lead Data Fetched from Meta:");
            console.log(JSON.stringify(leadData, null, 2));

            console.log("Page Details:");
            console.log(JSON.stringify(pageDetails, null, 2));

            /*
            // Prepare the lead data for saving to MongoDB
            const newLead = {
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

            console.log("Prepared Lead Data:", JSON.stringify(newLead, null, 2));
            */
          } catch (error) {
            console.error("Error fetching lead data:", error.message);
          }
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.status(404).send("Nothing Found");
  }
});

// Function to Fetch Lead Data by Lead ID
const getLeadData = async (leadgenId) => {
  const response = await axios.get(
    `https://graph.facebook.com/v17.0/${leadgenId}?access_token=${USER_ACCESS_TOKEN}`
  );
  return response.data;
};

// Function to Fetch Page Details
const getPageDetails = async (pageId) => {
  const response = await axios.get(
    `https://graph.facebook.com/v17.0/${pageId}?fields=name&access_token=${USER_ACCESS_TOKEN}`
  );
  return response.data;
};

// Fetch All Pages and Their Leads
const fetchAllLeads = async () => {
  try {
    // Fetch all Pages linked to the User Access Token
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts?fields=id,name&access_token=${USER_ACCESS_TOKEN}`
    );
    const pages = pagesResponse.data.data;

    for (const page of pages) {
      console.log(`Fetching leads for Page: ${page.name}`);

      // Fetch leadgen forms for the Page
      const formsResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}/leadgen_forms?access_token=${USER_ACCESS_TOKEN}`
      );
      const forms = formsResponse.data.data;

      for (const form of forms) {
        console.log(`Fetching leads for Form ID: ${form.id}`);

        // Fetch leads for the form
        const leadsResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${form.id}/leads?access_token=${USER_ACCESS_TOKEN}`
        );

        for (const lead of leadsResponse.data.data) {
          console.log("Fetched Lead Data:");
          console.log(JSON.stringify(lead, null, 2));

          /*
          const newLead = {
            formId: form.id,
            leadgenId: lead.id,
            pageId: page.id,
            pageName: page.name,
            fullName:
              lead.field_data.find((field) => field.name === "full_name")?.values[0] || "N/A",
            email: lead.field_data.find((field) => field.name === "email")?.values[0] || "N/A",
            phoneNumber:
              lead.field_data.find((field) => field.name === "phone_number")?.values[0] || "N/A",
            createdTime: lead.created_time,
          };

          console.log("Prepared Lead Data for Saving:");
          console.log(JSON.stringify(newLead, null, 2));
          */
        }
      }
    }
  } catch (error) {
    console.error("Error fetching pages or leads:", error.message);
  }
};

// Start the Server
app.listen(5000, () => {
  console.log("Server is running on port 5000");
  // Optionally, fetch all leads when the server starts
  fetchAllLeads();
});
