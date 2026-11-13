# Test certificate

`server.p12` is a self-signed localhost identity for automated HTTPS tests only.
Its password is `fixture-only-password`. It contains an intentionally public test
private key and must never be used in deployment. No user certificate is included.
