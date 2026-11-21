## 1. Feature Overview
- **Project / Feature:** Social & WhatsApp Login (v1)  
- **JIRA / Requirement:** KAN-4 (Epic)  
- **Business goal:** Reduce friction in sign‑up/login, increase login success rate, lower OTP cost, and achieve ≥50 % of logins via social or WhatsApp within 90 days post‑launch [Source: KAN-4 description – Goals & success metrics].  
- **Requirements reviewed:** User stories US‑1 – US‑6 and acceptance criteria; UX requirements; functional flows; non‑functional requirements; analytics events; dependencies; risks & mitigations (all sections of KAN-4).  
- **Impacted areas:**  
  - UI (login screen, Settings → Login methods)  
  - API / services (OAuth handling, WhatsApp OTP generation & verification, account linking, rate‑limit & bot‑check services)  
  - Database (user identity records, linked provider IDs, OTP hash storage)  
  - Integrations (Google, Apple, Facebook OAuth, WhatsApp Cloud API)  
  - Platforms (Android, iOS, Web)  

## 2. Scope and Objectives
- **In scope:**  
  - Google Sign‑In (Android, iOS, Web)  
  - Sign‑in with Apple (iOS; optional Web)  
  - Facebook Login (Android, iOS, Web)  
  - WhatsApp login (one‑time code via WhatsApp Business Platform, autofill on Android, copy‑code on iOS/Web)  
  - Account linking/unlinking UI and backend logic  
  - Fallback to SMS OTP or email when WhatsApp delivery fails  
  - Remote‑configurable button order and provider kill‑switch  
  - Analytics events listed in section 9  
  - Security, privacy, performance, availability NFRs (section 8)  
  - All acceptance criteria for US‑1 – US‑6 (section 5)  

- **Out of scope:**  
  - X/Twitter, LinkedIn, Microsoft, GitHub logins (explicitly out of scope v1)  
  - WhatsApp zero‑tap flow (out of scope v1)  
  - Social sharing / friend import (out of scope v1)  
  - Enterprise SSO, passkeys, removal of email/password login, MFA redesign (non‑goals)  

- **Testing objectives:**  
  - Verify that each social provider and WhatsApp login creates or accesses an account per acceptance criteria.  
  - Confirm correct handling of email collisions, provider errors, and OTP edge cases.  
  - Ensure NFRs (security, privacy, performance, availability) are met.  
  - Validate analytics events fire with required properties.  
  - Demonstrate that remote‑config can hide failing providers without UI breakage.  

- **Definition of tested:**  
  - End‑to‑end flows where a user (new or returning) successfully signs up or logs in using any in‑scope method, with correct backend token issuance and UI state.  
  - Negative flows where provider consent is denied, network fails, OTP expires, or delivery fails, resulting in appropriate error UI and no orphan accounts.  
  - Regression paths for existing email/password and SMS OTP flows remaining functional.  

## 3. Risk and Impact Assessment
| Risk / Impact | Likelihood | Business Priority | Test Area / Impact | Mitigation |
|---|---|---|---|---|
| WhatsApp template rejected or pricing change | Medium (as noted in Risks) | High (affects cost & fallback) | WhatsApp OTP delivery & cost reduction | Submit templates early; keep SMS fallback; monitor cost [Source: KAN-4 Risks & mitigations] |
| Duplicate accounts across methods | Medium | High (user confusion, support tickets) | Account linking & email collision handling (US‑5) | Implement linking flow; require ownership proof before merge [Source: US‑5] |
| OTP pumping / toll fraud | Medium | High (security & cost) | Rate‑limit, bot checks, anomaly alerts (NFR) | Rate limits, reCAPTCHA/Play Integrity/App Attest, country allow‑list [Source: NFR Security] |
| Provider outage or policy change | Medium | High | Provider abstraction layer, remote‑config kill‑switch | Abstract provider calls; remote config can hide button [Source: Risks] |
| Apple App Store rejection (missing Sign‑in with Apple) | Low | Medium | iOS UI compliance with guideline 4.8 | Ship Apple login together with other socials as required [Source: Scope] |
| Delivery failure of WhatsApp OTP >30 s | Medium | Medium | Fallback to SMS OTP flow | Offer “Send via SMS instead” after 30 s [Source: US‑3] |
| Insufficient performance (backend auth >500 ms) | Low | Medium | Performance NFR | Load testing; monitor p95 latency <500 ms [Source: NFR Performance] |

- **Critical workflows:** Social sign‑up/login, WhatsApp OTP verification, account linking/unlinking.  
- **Regression impact areas:** Existing email/password login, SMS OTP flow, user profile management.  
- **Known residual risks:** Potential regional variations in WhatsApp adoption not yet decided (Open question) – may affect adoption metrics; not fully mitigated until decision made.  

## 4. Testing Coverage
- **Functional:** Validate positive paths for each social provider and WhatsApp login, negative paths for consent denial, provider errors, OTP expiry, and email collision handling (US‑1 – US‑6) [Source: User stories & acceptance criteria].  
- **Boundary / edge cases:** OTP attempts limit (5), expiry (5 min), rate‑limit thresholds (3 per 10 min, 10 per day), phone number formats (E.164), provider returning no email, hidden Apple relay email, linking/unlinking last login method restriction (15 min rule) [Source: US‑3, US‑4, NFR Security].  
- **Smoke / sanity:** Verify build launches with all login buttons visible per remote config; each button initiates provider SDK without crash; basic success flow returns access token.  
- **Integration / API:** Contract validation with Google, Apple, Facebook OAuth endpoints (token signature, aud, iss, exp, nonce); WhatsApp Cloud API template delivery and webhook handling; backend rate‑limit and bot‑check services.  
- **Regression:** Existing email/password sign‑up, SMS OTP login, password reset flows remain functional; ensure no new orphan accounts are created on failure paths.  
- **Exploratory:** Investigate provider‑specific edge cases (e.g., Facebook phone‑only accounts, Apple relay email), network latency spikes, and remote‑config toggling of providers.  
- **Compatibility:** Test on supported Android versions, iOS versions, and major browsers (Chrome, Safari, Edge) per platform matrix; verify UI touch target size (≥44×44 pt) and screen‑reader labels (WCAG 2.2 AA).  
- **Non‑functional, where relevant:**  
  - *Performance:* Measure backend auth latency p95 < 500 ms; WhatsApp OTP delivery p90 ≤ 10 s [Source: NFR Performance].  
  - *Security:* Verify PKCE, nonce/state validation, OTP hash storage, rate limits, bot checks, audit logging.  
  - *Accessibility:* Check WCAG 2.2 AA compliance for labels, contrast, focus order.  
  - *Localization:* Ensure all strings are translatable; WhatsApp template approved per language.  
- **monkey testing:** Not applicable — feature relies on deterministic OAuth flows and OTP generation; random UI actions would not add value.

## 5. Test Approach
- **Manual testing:**  
  - Validate UI layout, button order per remote config, WCAG 2.2 AA compliance, brand guideline adherence, and error messaging for consent cancellation, network failures, and provider downtime (US‑6).  
  - Exploratory checks of account linking/unlinking flows, especially the “cannot unlink last method” rule (US‑4).  
  - Verify fallback to SMS OTP when WhatsApp delivery fails (US‑3).  
  - Confirm correct handling of email collisions and required ownership proof (US‑5).  
  - Validate regional button ordering and “Last used” indicator (UX requirements).  

- **Automation:**  
  - End‑to‑end (E2E) scripts for happy‑path social sign‑up/login via Google, Apple, Facebook, and WhatsApp OTP (including autofill on Android, copy‑code on iOS/Web).  
  - Negative flows: provider error responses, OTP expiration, max‑attempt limit, delivery‑status webhook failure, and rate‑limit enforcement.  
  - API contract tests for backend token validation (signature, aud, iss, exp, nonce) and OTP hash verification.  
  - Performance checks for backend auth latency < 500 ms (p95) and WhatsApp OTP delivery < 10 s for 90 % of requests (Non‑functional requirements).  

- **Tools / framework:**  
  - Insufficient information to determine.  

- **Execution:**  
  - Manual exploratory sessions on local devices and QA environment.  
  - Automated E2E suites executed in CI/CD on each pull request and nightly scheduled runs.  

- **Automation selection:**  

| Feature / Flow                              | Automation Decision | Reason                                                                 |
|--------------------------------------------|---------------------|------------------------------------------------------------------------|
| Social sign‑up (Google, Apple, Facebook)   | Automate            | Repeatable OAuth flow, deterministic success/failure simulation possible via provider sandbox or mock. |
| WhatsApp OTP (code entry, autofill)        | Automate            | OTP generation and verification can be scripted; however, real WhatsApp delivery may require sandbox – defer if sandbox unavailable. |
| Account linking / unlinking                | Automate            | Straight‑forward UI actions with clear state verification. |
| UI/UX visual order, WCAG compliance        | Manual              | Requires human judgment, screen‑reader testing, and visual inspection. |
| Error handling (provider down, consent cancel) | Manual / Defer    | Simulating provider outages may need external mocks; defer until sandbox availability. |
| Performance & latency measurements         | Automate            | Can be captured via CI metrics; requires tooling support. |

- **Standards:**  
  - Reuse existing project test framework patterns, fixtures for authentication, and utility libraries for token handling, as per “reuse existing framework patterns” guideline (Inference (low confidence)).  

## 6. Environment and Test Data
- **Environments:**  
  - QA (for functional verification).  
  - Staging (pre‑release validation).  
  - UAT (business acceptance).  
  - No other environments mentioned.  

- **Build / configuration / feature flags:**  
  - Remote‑configurable button order per region (UX requirements).  
  - Feature‑flag to enable/disable each social provider and WhatsApp login (Rollout plan).  
  - Specific flag states not detailed → Insufficient information to determine.  

- **Browsers / devices / OS:**  
  - Android mobile app.  
  - iOS mobile app.  
  - Web browsers (unspecified).  
  - No explicit browser list → Insufficient information to determine.  

- **Accounts, roles and permissions:**  
  - Regular end‑user accounts for sign‑up/login.  
  - No privileged or admin roles described → Insufficient information to determine.  

- **Test data required and source:**  
  | Data Type                     | Source / Creation Method                                 |
  |-------------------------------|----------------------------------------------------------|
  | Valid Google, Apple, Facebook provider accounts (sandbox or test) | Provider sandbox accounts (not specified). |
  | Valid WhatsApp numbers (registered on WhatsApp Business) | Test phone numbers provisioned via WhatsApp Business Platform (section 10). |
  | Email addresses (including relay emails) | Generated test emails (e.g., Yopmail) – tool not specified. |
  | Phone numbers without WhatsApp registration (to trigger SMS fallback) | Generated test numbers – source not specified. |
  | OTP codes (6‑digit)           | Generated by backend during test; hash stored only. |
  | Account linking scenarios (multiple providers linked to same user) | Created via test flows. |

- **Email / OTP / payment / third‑party sandbox:**  
  - WhatsApp Business Platform sandbox required for OTP delivery (section 10).  
  - OAuth provider sandboxes (Google, Apple, Facebook) implied but not detailed → Insufficient information to determine.  

- **Data setup, isolation, reset and cleanup:**  
  - Each test run must create isolated user accounts and clean them up after execution to avoid collisions (US‑5).  
  - OTP hashes cleared after verification.  
  - No explicit cleanup procedure described → Insufficient information to determine.  

- **Environment or data constraints:**  
  - Rate limits: max 3 OTP sends per 10 min, 10 per day per phone (Non‑functional requirements).  
  - Bot‑protection checks (reCAPTCHA Enterprise / Play Integrity / App Attest) must be satisfied before OTP send (section 8).  
  - Remote config may hide provider buttons if a provider is down (Availability).  

## 7. Dependencies and Assumptions
- **Dependencies:**  

| Dependency                              | Owner / Team            | Status / Note |
|----------------------------------------|--------------------------|---------------|
| Google Cloud OAuth client IDs          | Platform / Infra team    | Required for Google Sign‑In (section 10). |
| Apple Developer Services ID & key      | iOS team / Apple liaison | Required for Sign‑in with Apple (section 10). |
| Meta app review for Facebook Login     | Mobile team / Meta contact | Required for Facebook Login (section 10). |
| Meta WhatsApp Business Platform (BSP)  | Backend team / Meta vendor | Verified business, sender number, approved templates (section 10). |
| Legal updates to Privacy Policy & Terms| Legal team               | Needed before launch (section 10). |
| Security review                         | Security team            | Scheduled in QA phase (section 13). |
| App Store & Play Store review           | Release/Compliance team  | Required for iOS/Android distribution (section 10). |
| Remote‑config service for button order | Platform team            | Controls UI ordering (UX requirements). |
| Bot‑protection services (reCAPTCHA, Play Integrity, App Attest) | Security/Infra team | Enforced before OTP send (section 8). |

- **Assumptions:**  

| Assumption                                                            | Confirmed? | Evidence |
|-----------------------------------------------------------------------|------------|----------|
| Consumer mobile and web app targeting emerging markets (India)       | Confirmed | [Source: KAN-4 description] |
| Existing email/password and SMS OTP login already in product          | Confirmed | [Source: KAN-4 description] |
| Users have Google, Apple, Facebook accounts and use WhatsApp daily    | Confirmed | [Source: KAN-4 description] |
| Remote config can dynamically hide provider buttons on outage         | Confirmed | [Source: KAN-4 non‑functional requirements – Availability] |
| OTP delivery via WhatsApp Business Platform is possible via Cloud API | Confirmed | [Source: KAN-4 functional flows – WhatsApp OTP] |
| Rate‑limit and bot‑check mechanisms are implemented on backend        | Confirmed | [Source: KAN-4 non‑functional requirements – Security] |
| No requirement to remove email/password login (non‑goal)             | Confirmed | [Source: KAN-4 description – Non‑goals] |
| Apple Sign‑In must be present on iOS due to App Store guideline 4.8   | Confirmed | [Source: KAN-4 scope] |
| WhatsApp zero‑tap is out of scope for v1                               | Confirmed | [Source: KAN-4 scope] |
| Test environments (QA, Staging, UAT) will be provisioned                | Unconfirmed | Not explicitly stated. |
| Provider sandbox credentials will be available for automated tests    | Unconfirmed | Not mentioned. |

- **Constraints:**  
  - Rate limits and bot‑check requirements may throttle automated OTP generation.  
  - Remote‑config driven UI may vary per region, requiring region‑specific test matrices.  
  - Provider approval timelines (Meta WhatsApp template, Facebook app review) could impact test schedule.  

- **Open questions:**  

| Question                                                            | Owner | Impact on testing / approval |
|---------------------------------------------------------------------|-------|------------------------------|
| Which regions should WhatsApp be the primary login option?         | Product Owner | Determines test matrix for button order and remote‑config settings. |
| Is Facebook Login worth the app‑review effort?                     | Product Owner / Mobile Lead | May affect inclusion of Facebook in test scope. |
| Should a phone number verified via WhatsApp count for KYC elsewhere? | Compliance / Legal | Could introduce additional data handling requirements. |
| What is the monthly budget cap for WhatsApp authentication conversations? | Finance / Product Owner | May limit volume of automated OTP tests. |  

## 8. Defect Management
- **Tracking tool:** JIRA (as used for the feature epic KAN‑4).  

- **Defect details (template):**  
  - **Summary:** Concise title.  
  - **Description:** Steps to reproduce, expected result, actual result.  
  - **Environment / Build:** QA, Staging, app version, feature‑flag state.  
  - **Attachments:** Screenshots, logs, network traces.  
  - **Linked Requirement:** Reference to user story (e.g., US‑3) or acceptance criterion.  

- **Severity / priority:** Follow project‑defined matrix (not provided) – use standard mapping (e.g., Blocker, Critical, Major, Minor, Trivial).  

- **Triage and ownership:**  
  - Triage meeting daily with QA Lead, Product Owner, and relevant engineering owners (backend, mobile, web).  
  - Ownership assigned based on component (e.g., OAuth issues → Backend owner; UI mis‑alignment → Frontend owner).  

- **Retest and regression approach:**  
  - Defects fixed in a build are retested in the same environment.  
  - Regression suite includes all social login flows and OTP paths; executed on each release candidate.  

- **Known issues / accepted risks:**  
  - **Risk:** WhatsApp template rejection or pricing change may delay OTP delivery testing.  
    - **Mitigation / Acceptance:** Proceed with SMS fallback; record as accepted risk until template approved.  
    - **Approver:** Product Owner (as per Risks & mitigations table).  
  - **Risk:** Provider outage may hide button via remote config, affecting UI tests.  
    - **Mitigation / Acceptance:** Validate remote‑config kill‑switch behavior; treat as known issue during outage simulations.  
    - **Approver:** Release Engineer.

## 9. Entry and Exit Criteria
**Entry:**  
- Requirements and acceptance criteria are sufficiently clear. [Source: KAN-4 description – sections 5‑6, 7‑9]  
- Build is deployed and environment is accessible. *Insufficient information to determine.*  
- Required data, access and dependencies are ready. *Insufficient information to determine.*  
- Required developer checks / handover are complete. *Insufficient information to determine.*

**Exit:**  
- Agreed acceptance criteria and planned coverage are validated. [Source: KAN-4 description – “User stories & acceptance criteria”]  
- Critical workflows and required regression checks pass. *Insufficient information to determine.*  
- Defects are resolved or formally accepted by the authorized owner. *Insufficient information to determine.*  
- Blocked / untested cases and residual risks are documented. [Source: KAN-4 description – “Risks & mitigations”]  
- Results and QA recommendation are shared. *Insufficient information to determine.*

*Waived criteria:* None identified at this stage.  

## 10. Roles, Schedule and Deliverables
- **QA Lead:** Strategy, risk, coordination, reporting and QA recommendation.  
- **QA Engineer:** Test design, execution, evidence, defect reporting and retesting.  
- **Developer:** Unit checks, technical clarification, defect fixes and handover.  
- **Product / BA:** Requirement clarification and acceptance criteria.  
- **Business / UAT:** Business validation and acceptance.  
- **Other owners:** Automation, DevOps, Security, Performance, vendor, as applicable.  

- **Milestones / dates:**  
  * Design & provider setup – weeks 1‑2 (per timeline). [Source: KAN-4 description – “Timeline (indicative)”]  
  * Backend auth + linking – weeks 3‑5.  
  * Mobile & Web client implementation – weeks 3‑5 (parallel).  
  * QA, security review, store review – weeks 6‑7.  
  * Staged rollout – weeks 8‑9.  

- **Resource or specialist needs:**  
  * OAuth/OIDC provider integration specialist (Google, Apple, Facebook).  
  * WhatsApp Business Platform integration specialist.  
  * Security reviewer for PKCE, nonce, token validation.  
  * Localization specialist for multi‑language WhatsApp templates.  

- **Deliverables:**  
  * Test Strategy (this document).  
  * Test scenarios / cases mapped to each user story (US‑1 – US‑6).  
  * Traceability matrix linking requirements, acceptance criteria, and test cases.  
  * Automation artefacts (if applicable) for OAuth flow and OTP verification.  
  * Defect records in JIRA.  
  * Execution report with results and QA recommendation.  

## 11. Reporting and Metrics
- **Reporting tool:** JIRA (issues, test execution tickets) and test‑management dashboard (e.g., Xray, Zephyr).  
- **Frequency and audience:**  
  * Daily status update to Scrum Team (QA, Development, Product).  
  * Weekly summary to Release Management & Stakeholders.  
  * Post‑rollout report to Executive Steering Committee.  

- **Metrics:**  
  * **Planned tests** = total test cases defined for all user stories.  
  * **Executed tests** = count of test cases run.  
  * **Passed** = executed ∧ result = Pass.  
  * **Failed** = executed ∧ result = Fail.  
  * **Blocked** = test cases unable to run due to missing functionality or environment.  
  * **Not‑run** = planned but not executed (e.g., out‑of‑scope).  
  * **Pass rate** = (Passed / Executed) × 100 %.  
  * **Defects by severity** = count of logged defects grouped by Critical, Major, Minor.  
  * **Requirement coverage** = (Number of requirements with at least one passed test / Total requirements) × 100 %.  
  * **Automation coverage** = (Automated test cases / Total test cases) × 100 %.  
  * **Residual risk index** = (Sum of identified risk severity scores × unmitigated probability) / Number of risks.  

- **Report includes:** Build/environment version, scope of execution, summary of passed/failed/blocked tests, blockers, defect list with severity, evidence links, and next actions.  

## 12. Human Review and Approval Gate --- Mandatory
**Assumptions:**  
- The product is a consumer mobile and web app targeting India and emerging markets. [Source: KAN-4 description – “Assumptions”]  
- Existing email/password and SMS OTP login remain functional and are used as fallback. [Source: KAN-4 description – “Scope”]  
- Remote‑config will control button order and provider kill‑switches. [Source: KAN-4 description – “UX requirements”]  

**Information that could not be confirmed:**  
- Exact build version and deployment pipeline details.  
- Availability of test accounts for each social provider and WhatsApp Business Platform.  
- Specific performance thresholds for client‑side latency (e.g., time‑to‑login < 10 s) beyond the stated metric.  
- Detailed rate‑limit values for OTP generation per IP/device (only high‑level limits are described).  

**Blocking open questions:**  
- Which regions will have WhatsApp as the primary login option? (Open question listed in PRD). [Source: KAN-4 description – “Open questions”]  
- Is Facebook Login required given the app‑review effort? (Open question).  
- Will a WhatsApp‑verified phone number be reused for other KYC/verification flows? (Open question).  
- What is the monthly budget cap for WhatsApp authentication conversations? (Open question).  

**Non‑blocking questions:**  
- Preferred naming convention for analytics events beyond those listed.  
- Whether the “More options” button will include a “Login with Email” flow or only SMS OTP.  
- Exact UI dimensions for touch targets on tablets (spec only mentions 44×44 pt).  

**Identified risks:**  
- WhatsApp template rejection or pricing changes could delay rollout. [Source: KAN-4 description – “Risks & mitigations”]  
- Duplicate accounts across login methods if linking logic fails. [Source: KAN-4 description – “Risks & mitigations”]  
- OTP pumping or toll‑fraud despite rate limits and bot checks. [Source: KAN-4 description – “Risks & mitigations”]  
- Provider outage leading to hidden buttons via remote config; need robust abstraction layer. [Source: KAN-4 description – “Risks & mitigations”]  
- Potential App Store rejection if Sign‑in with Apple is not correctly implemented. [Source: KAN-4 description – “Risks & mitigations”]  

**QA recommendations:**  
- Prioritize early validation of provider SDK integrations (Google, Apple, Facebook) in isolated test harnesses.  
- Implement end‑to‑end test harness for WhatsApp OTP delivery, including webhook simulation for delivery‑status failures.  
- Create a dedicated “account linking” test matrix covering all permutations of login method combinations and edge cases (e.g., last login > 15 min).  
- Establish mock/stub services for provider outages to verify remote‑config kill‑switch behavior.  
- Conduct accessibility testing to confirm WCAG 2.2 AA compliance for button order, touch targets, and screen‑reader labels.  
- Align test data generation with GDPR/DPDP consent requirements; ensure test accounts can be safely deleted.  
- Schedule a security review focused on PKCE, nonce validation, OTP hash storage, and audit‑log generation before the “QA, security review” milestone.

**Approval Status:** Pending Human Approval
