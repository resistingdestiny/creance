// The container health check: GET /health on the port the API listens on.
//
// A file rather than an inline `node -e "..."` in compose.yaml. podman-compose
// flattens an exec form health check into one shell string and loses the
// quoting, so a command carrying parentheses and quotes fails with a shell
// syntax error and the container never becomes healthy. See
// docs/harness-notes.md. A path with no shell metacharacters in it survives
// both runtimes.
//
// Plain node with no dependency, because it runs inside the image and has to
// work whether or not anything else is installed.

const port = process.env.PORT ?? '3210';
const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
process.exit(response !== null && response.ok ? 0 : 1);
