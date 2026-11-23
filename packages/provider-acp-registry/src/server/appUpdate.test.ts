import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import { createProviderVersionAdvisory } from "@t3tools/provider-core/server/maintenanceResolver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  appBinaryFromCommand,
  appBundleOf,
  appUpdateFeedUrl,
  appUpdateMaintenance,
  inspectAppUpdate,
  parseFeedVersion,
} from "./appUpdate.ts";

const FEED_CONFIG = `provider: generic
url: https://download.example.com/desk/feeds/mac-arm64/
channel: nightly
updaterCacheDirName: '@example-desktop-updater'
`;
const FEED = `version: 0.2.3-alpha.2
files:
  - url: >-
      https://download.example.com/desk/bin/mac-arm64/app-0.2.3-alpha.2-mac-arm64.zip
    size: 365597921
releaseDate: '2026-11-23T03:12:30.263Z'
stagingPercentage: 10
`;
const plist = (version: string) =>
  `<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`;

describe("appUpdate", () => {
  it("finds the app binary a local command runs", () => {
    expect(
      appBinaryFromCommand("/usr/bin/env", [
        "DSH_BIN=/opt/homebrew/bin/dsh",
        "/opt/homebrew/bin/python3",
        "/bridges/dsh-acp",
      ]),
    ).toBe("/opt/homebrew/bin/dsh");
    expect(appBinaryFromCommand("/Applications/A.app/Contents/MacOS/a-acp", [])).toBe(
      "/Applications/A.app/Contents/MacOS/a-acp",
    );
    expect(appBinaryFromCommand("python3", ["bridge"])).toBeUndefined();
    expect(appBundleOf("/Applications/Deep Seek.app/Contents/Resources/cli/bin/dsh")).toBe(
      "/Applications/Deep Seek.app",
    );
    expect(appBundleOf("/opt/homebrew/bin/python3")).toBeUndefined();
  });

  it("reads the feed of a generic app-update.yml and the release it announces", () => {
    expect(appUpdateFeedUrl(FEED_CONFIG)).toBe(
      "https://download.example.com/desk/feeds/mac-arm64/nightly-mac.yml",
    );
    expect(appUpdateFeedUrl("provider: generic\nurl: https://x.example/f")).toBe(
      "https://x.example/f/latest-mac.yml",
    );
    expect(appUpdateFeedUrl("provider: github\nowner: a\nrepo: b")).toBeUndefined();
    expect(appUpdateFeedUrl("provider: generic\nurl: http://x.example/f")).toBeUndefined();
    expect(parseFeedVersion(FEED)).toBe("0.2.3-alpha.2");
    expect(parseFeedVersion("<html>")).toBeUndefined();
  });

  it.effect("announces a newer release of the app without offering to install it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const app = path.join(root, "Harness.app");
      const binary = path.join(app, "Contents/Resources/runtime/cli/bin/dsh");
      yield* fs.makeDirectory(path.dirname(binary), { recursive: true });
      yield* fs.writeFileString(binary, "#!/bin/sh\n");
      yield* fs.writeFileString(path.join(app, "Contents/Info.plist"), plist("0.2.2-rc.5"));
      yield* fs.writeFileString(path.join(app, "Contents/Resources/app-update.yml"), FEED_CONFIG);
      const link = path.join(root, "dsh");
      yield* fs.symlink(binary, link);

      const install = yield* inspectAppUpdate(link);
      expect(install).toEqual({
        app: yield* fs.realPath(app),
        version: "0.2.2-rc.5",
        feedUrl: "https://download.example.com/desk/feeds/mac-arm64/nightly-mac.yml",
      });
      const requests: string[] = [];
      const client = HttpClient.make((request) => {
        requests.push(request.url);
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(FEED)));
      });
      const provider = ProviderDriverKind.make("acpRegistry");
      const maintenance = appUpdateMaintenance(provider, install!, Option.some(client));
      expect(maintenance.update).toBeNull();
      const latestVersion = yield* maintenance.lookupLatestVersion!;
      expect(latestVersion).toBe("0.2.3-alpha.2");
      expect(requests).toEqual([install!.feedUrl]);
      expect(
        createProviderVersionAdvisory({
          driver: provider,
          currentVersion: install!.version,
          latestVersion,
          maintenanceCapabilities: maintenance,
        }),
      ).toMatchObject({ status: "behind_latest", canUpdate: false });

      yield* fs.remove(path.join(app, "Contents/Resources/app-update.yml"));
      expect(yield* inspectAppUpdate(link)).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
