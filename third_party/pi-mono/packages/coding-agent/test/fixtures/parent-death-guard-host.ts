import { createLocalBashOperations } from "../../src/core/tools/bash.ts";

const markerFile = process.argv[2];
if (!markerFile) throw new Error("marker file argument is required");

const operations = createLocalBashOperations({ parentDeathGuard: true });
await operations.exec('echo $$ > "$ALRAN_PARENT_DEATH_MARKER"; while true; do sleep 0.1; done', process.cwd(), {
	env: { ...process.env, ALRAN_PARENT_DEATH_MARKER: markerFile },
	onData: () => undefined,
});
