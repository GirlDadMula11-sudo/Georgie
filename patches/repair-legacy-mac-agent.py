#!/usr/bin/env python3
import hashlib
from pathlib import Path

repo = Path("/Users/mac/Georgie")
target = repo / "mac-agent/agent.js"
data = target.read_bytes()
blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
expected = "df95551694842535d7713016ac30770744d9721e"
if blob != expected:
    raise SystemExit(f"REFUSED: expected {expected}, observed {blob}")

text = data.decode("utf-8")
guard = '      if (observedBlobs["src/tools.js"] !== mainBlobs["src/tools.js"]) throw new Error("PRIMARY_MAC_TOOLS_NOT_REMOTE_IDENTICAL");\n'
anchor = '      const after = (await runDeveloper("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();\n'
old_return = "restoreVerified: true, fastForwardOnly: true"
new_return = "restoreVerified: true, preservedWorktreeRestored: true, fastForwardOnly: true"
insert = '''      for (const file of preservePaths) {
        const target = path.join(repo, file);
        await fs.writeFile(target, sourceBytes[file]);
        const restored = await fs.readFile(target);
        if (gitBlobSha(restored) !== observedBlobs[file]) throw new Error(`PRIMARY_MAC_PRESERVED_RESTORE_VERIFY_FAILED:${file}`);
      }
      const preservedStatus = await runDeveloper("git", ["-C", repo, "status", "--porcelain=v1", "--untracked-files=all"]);
      const preservedDirtyPaths = preservedStatus.stdout.split("\\n").filter(Boolean).map(line => line.slice(3));
      if (preservedDirtyPaths.length !== preservePaths.length || preservePaths.some(file => !preservedDirtyPaths.includes(file))) throw new Error("PRIMARY_MAC_PRESERVED_RESTORE_SCOPE_FAILED");
'''
for name, needle in (("guard", guard), ("merge anchor", anchor), ("return marker", old_return)):
    if text.count(needle) != 1:
        raise SystemExit(f"REFUSED: expected exactly one {name}, found {text.count(needle)}")
text = text.replace(guard, "", 1)
text = text.replace(anchor, anchor + insert, 1)
text = text.replace(old_return, new_return, 1)
tmp = target.with_suffix(".js.georgie-repair-tmp")
tmp.write_text(text, encoding="utf-8")
tmp.replace(target)
new_data = target.read_bytes()
new_blob = hashlib.sha1(b"blob " + str(len(new_data)).encode() + b"\0" + new_data).hexdigest()
print(f"REPAIRED mac-agent/agent.js {blob} -> {new_blob}")
