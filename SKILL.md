Use this repository as a small GitHub Actions runner harness only.

- Keep the public source generic.
- Do not add workload-specific code, endpoints, package names, comments, or logs.
- Do not store secrets in GitHub.
- Runtime keys and the private executable bundle come from the external broker
  after GitHub OIDC validation.
