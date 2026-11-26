# CrewAI console design review

CrewAI organizes its console around the lifecycle of an automation. The persistent sidebar groups destinations under **Build**, **Operate**, and **Manage**. Studio helps users articulate a job, the repositories make building blocks reusable, and operations pages shift the emphasis to executions, configuration, and fleet health.

## Visual language and approachability

- **Surfaces and color.** White content areas, a pale gray sidebar, fine borders, and muted labels keep the shell quiet. Blue highlights primary actions and selected controls. Studio uses a faint blue grid and a pale blue-to-mint wash, while Automations uses a coral illustration to draw attention to onboarding.
- **Hierarchy and spacing.** Studio's large conversational heading and generous composer create a clear starting point. Management pages use compact headings, small icons, and more restrained spacing. Empty states have room to explain what a resource enables.
- **Guidance in context.** Studio places concrete examples inside the composer panel. Operations pages explain the next step where results will eventually appear. Settings puts a copy control beside the organization ID and explains its use in API requests.
- **Friction observed.** Studio's examples fell below the fold in the shorter desktop window, and some card descriptions truncated at the wider size. Settings used a horizontally scrolling tab row at the narrower desktop width.

## Page observations

| Page | Design observation |
|---|---|
| [Crew Studio](https://app.crewai.com/studio/v2) | A natural-language composer asks what the user wants to build. Six examples cover recognizable jobs such as triaging GitHub issues and reconciling invoices, with integration logos for context. The nearby mode picker describes Flows as beta and suitable for new projects, and Crews as the classic Studio experience. Projects and a Create New tile sit below the composer. |
| [Automations](https://app.crewai.com/crewai_plus/dashboard) | The empty dashboard uses a coral rocket illustration and a prominent introduction to deploying crews. At the shorter window height, part of the guidance continued below the fold. |
| [Agents Repository](https://app.crewai.com/crewai_plus/agents) | The empty state explains reuse across workflows and projects. It presents separate actions for creating a native CrewAI agent and connecting an external A2A agent. |
| [Skills Repository](https://app.crewai.com/crewai_plus/skills) | Search and a result count frame skills as a browsable collection. The empty state explains that published instructions can be reused in Studio projects and repository agents. |
| [Tools & Integrations](https://app.crewai.com/crewai_plus/connections) | Search, a Create connection action, and application, creator, and tag filters remain visible with no connections. The table headers explain what the inventory tracks, including sharing, triggers, last use, and executions. |
| [Traces](https://app.crewai.com/crewai_plus/trace_batches) | A full-width search field supports looking up automations or executions. Status, type, and execution filters support narrowing results. The empty state ties traces to running crews. |
| [LLM Connections](https://app.crewai.com/crewai_plus/llm_connections) and [Environment Variables](https://app.crewai.com/crewai_plus/environment_variables) | Both use a predictable setup layout with search beneath the header, Refresh and a blue add action at the top, and a dashed empty-state panel explaining what configuration enables. |
| [Agent Control Plane](https://app.crewai.com/crewai_plus/agent_control_plane) | Large counts show active automations, errors, and executions. A separate Consumption card shows cost and tokens. Time presets scope the overview, and the display distinguishes zero values from missing prior data. |
| Usage Dashboard | Insights and Deployments have separate tabs. Summary tiles foreground crews, executions, deployments, and users. Time range, period, and aggregation controls sit below the summary. |
| [Billing](https://app.crewai.com/crewai_plus/settings/billing) and [Organization Settings](https://app.crewai.com/crewai_plus/settings/organization) | Billing puts the current plan and execution allowance above plan choices. Organization Settings explains how the copyable organization ID is used when targeting an organization through the API. |

## Comparison with Groq

Crew Studio and Groq Playground both center a prompt. CrewAI uses it to turn a job description into an automation, with examples to help users choose a starting point. Groq places prompt, response, and code together so developers can follow an experiment into an API call.

The difference carries into monitoring. CrewAI Traces starts with an automation or execution, and Agent Control Plane starts with fleet health. Groq Logs starts with an individual request, and Metrics starts with traffic scoped by time, model, and API key. [Groq Playground](https://console.groq.com/playground) · [Groq Logs](https://console.groq.com/dashboard/logs) · [Groq Metrics](https://console.groq.com/dashboard/metrics)

## Review scope

Observed in the signed-in desktop console using Computer Use in Chrome. Studio coverage ends at its landing view and mode picker. Repository and configuration observations reflect mostly empty states. Populated CrewAI workflows, the Studio project editor, individual administrative subtabs, mobile behavior, and exact color and contrast measurements were outside the review.
