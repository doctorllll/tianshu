import type {
  EnvironmentId,
  ProviderInstanceId,
  ProviderNativeHostStatus,
} from "@t3tools/contracts";
import { RegistryContext } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { InfoIcon } from "lucide-react";
import { memo, useContext, useEffect, useState } from "react";

import { uiText as copy } from "~/i18n";
import { nativeHostStart, nativeHostStatus } from "../../state/nativeHost";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

const POLL_MS = 15_000;

/** Offers to start the native app the selected agent depends on (Antigravity, fastctx-web). */
export const NativeHostBanner = memo(function NativeHostBanner({
  environmentId,
  instanceId,
  agentName,
}: {
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId | null;
  agentName: string;
}) {
  const registry = useContext(RegistryContext);
  const startHost = useAtomCommand(nativeHostStart, { label: "Start native app" });
  const key = instanceId === null ? null : `${environmentId}\u0000${instanceId}`;
  const [reading, setReading] = useState<{
    readonly key: string;
    readonly status: ProviderNativeHostStatus | null;
  } | null>(null);
  const [phaseFor, setPhaseFor] = useState<{
    readonly key: string;
    readonly phase: "starting" | "failed";
  } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls an app that runs outside the client while its agent is selected
  useEffect(() => {
    if (instanceId === null || key === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const result = await runAtomCommand(
        registry,
        nativeHostStatus,
        { environmentId, input: { instanceId } },
        { label: nativeHostStatus.label, reportFailure: false, reportDefect: false },
      );
      if (cancelled) return;
      const status = result._tag === "Success" ? result.value : null;
      setReading({ key, status });
      // Agents without a native app answer null once; there is nothing to watch.
      if (status !== null) timer = setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [environmentId, instanceId, key, registry]);

  const status = reading !== null && reading.key === key ? reading.status : null;
  if (instanceId === null || key === null || status === null || status.running) return null;
  const phase = phaseFor !== null && phaseFor.key === key ? phaseFor.phase : "idle";

  const start = async () => {
    setPhaseFor({ key, phase: "starting" });
    const result = await startHost({ environmentId, input: { instanceId } });
    const next = result._tag === "Success" ? result.value : null;
    if (next !== null) setReading({ key, status: next });
    setPhaseFor(next?.running ? null : { key, phase: "failed" });
  };
  const app = status.label;

  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[calc(100%-2rem)] pt-3">
      <Alert variant="warning" role="status" surface="glass" controlAlignment="first-line">
        <InfoIcon />
        <AlertTitle>{copy("{app} is not running", { app })}</AlertTitle>
        <AlertDescription>
          <div className="flex flex-col gap-2">
            <div>
              {phase === "failed"
                ? copy("{app} did not answer yet. Try again in a moment.", { app })
                : copy("{agent} works only while {app} runs. Start it in the background?", {
                    agent: agentName,
                    app,
                  })}
            </div>
            {status.canStart ? (
              <div className="flex justify-end">
                <Button size="xs" disabled={phase === "starting"} onClick={() => void start()}>
                  {phase === "starting"
                    ? copy("Starting {app}…", { app })
                    : copy("Start in background")}
                </Button>
              </div>
            ) : null}
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
});
