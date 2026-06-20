# atlas

Minimal scheduled runner harness.

The workflow accepts a job name, proves its GitHub Actions identity with OIDC,
fetches runtime configuration and a private executable bundle from the control
plane, then runs the bundle.

No workload credentials or implementation live in this repository.
