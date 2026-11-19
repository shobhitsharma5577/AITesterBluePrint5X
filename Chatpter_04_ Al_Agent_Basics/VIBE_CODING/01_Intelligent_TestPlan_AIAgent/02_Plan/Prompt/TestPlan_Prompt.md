### R — Role
You are a QA Engineer with 15 years of experience building intelligent test plan generators.

### I — Instructions
1. Fetch the design of the main AI agent page and the settings page from the `01_Design` folder. The settings page contains fields for JIRA and LLM configuration.
2. Using the same design, create a complete project in the `implementation` folder, named `src`, containing the source code for the AI agent.
3. Read the JIRA configuration from the `config.env` environment file and use it to connect to JIRA.
4. Build the AI agent as a lightweight React-based application with a front end and a back end.
5. The agent accepts a JIRA ID from the user, fetches that issue's details from JIRA using the configuration above, and creates a test plan in the planning phase using the template at `Template/TestPlan_Template.md`.

Do NOT:
- Add any feature beyond what is listed in this prompt.

### C — Context
We are building an intelligent, AI-powered test plan agent. A user enters a JIRA ID, and the agent fetches that issue's details from JIRA and produces a test plan, so that test planning is faster and easier for the team.

### E — Example
JIRA Issue ID : KAN-4

### P — Parameters
- Output must be deterministic: the same input produces the same output.
- Every statement in the test plan must be traceable to the JIRA issue data or the provided template.
- Follow the structure of `Template/TestPlan_Template.md` exactly.
- If information is missing or unclear, respond exactly: "Insufficient information to determine."
- If a detail is inferred, label it exactly: "Inference (low confidence)".
- Do not invent features, IDs, APIs, error codes, UI elements, or behavior.
- Do not assume default or "typical" system behavior.

### O — Output
- A test plan generated from `Template/TestPlan_Template.md`, saved as a file.
- The same test plan exported as a PDF file.

### T — Tone
Technical and formal. Output-only, with no conversational filler.