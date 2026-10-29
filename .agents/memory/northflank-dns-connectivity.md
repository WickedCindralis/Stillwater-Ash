---
name: NorthFlank DNS connectivity
description: Troubleshooting direct Replit-to-NorthFlank database connections without changing application code
---
When a direct database connection to NorthFlank fails with `ENOTFOUND`, first verify the connection URL parses and that the expected-host setting matches its hostname. Then check DNS from the same runtime that makes the connection. DNS can begin resolving between attempts, so a prior `ENOTFOUND` alone does not prove the endpoint is permanently invalid. In this environment, `nslookup` may be absent; `getent ahosts <hostname>` can confirm whether the system resolver returns an address.

**Why:** A NorthFlank endpoint initially returned `ENOTFOUND`, then resolved on a later check after the connection setting was corrected; the migration and smoke checks subsequently succeeded without code changes.

**How to apply:** Before modifying connection code or replacing an endpoint, validate the secret-backed URL and expected host, run a read-only resolver check from the application environment, and retry only after the hostname resolves. Never print the connection string or credentials.
