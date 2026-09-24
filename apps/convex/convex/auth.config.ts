// Convex Auth issues JWTs signed with JWT_PRIVATE_KEY; the deployment verifies
// them against its own JWKS served from the site URL.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
