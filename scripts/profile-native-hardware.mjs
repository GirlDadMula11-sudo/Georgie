import { buildNativeHardwareProfile } from "../src/native-hardware-profile.js";

process.stdout.write(`${JSON.stringify(buildNativeHardwareProfile(), null, 2)}\n`);
