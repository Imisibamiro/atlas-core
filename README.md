# atlas

Minimal scheduled runner harness.

The workflow accepts a job name, proves its GitHub Actions identity with OIDC,
fetches runtime configuration and a private executable bundle from the control
plane, then runs the bundle.

No workload credentials or implementation live in this repository.

Full retries must use **Re-run all jobs** so setup initializes the new attempt. Each full retry uses a new shared execution ID and the GitHub attempt start time. To resume only an incomplete part, use its explicit recovery dispatch with the original context; **Re-run failed jobs** does not initialize a fresh context.
