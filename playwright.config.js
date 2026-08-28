import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./tests/e2e",workers:1,retries:1,timeout:45_000,
  use:{baseURL:"http://127.0.0.1:4310",trace:"retain-on-failure",screenshot:"only-on-failure",video:"retain-on-failure"},
  reporter:process.env.CI?[["line"],["html",{open:"never"}]]:"line"
});
