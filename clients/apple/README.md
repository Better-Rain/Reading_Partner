# Reading Partner for Mac and iPhone

The SwiftUI client opens the existing private library in WKWebView. Device pairing and reading accounts are separate. Use the same reading account across clients to resume your own progress. Only the server's public CA is bundled. The app checks the selected host against the server certificate.

## Build on the library Mac

On the build Mac, open `clients/apple` inside the source checkout. Set up the ignored deployment file described in `docs/PRIVATE_LIBRARY.md`, or set `RP_CONNECTION_FILE` to its path. Then run:

```sh
python3 enroll.py
bash build.sh mac
bash build.sh sim
bash build.sh device-check
```

The Mac client uses the local server and the Mac-specific pairing file automatically. Build products are under `build/Build/Products`. To install the Mac build, copy `Release/Reading Partner.app` to `/Applications` and launch it. `device-check` compiles the unsigned iPhone target.

## Install on iPhone

1. Connect and unlock the iPhone on the build Mac and trust the computer. Enable Developer Mode when prompted.
2. Open `ReadingPartner.xcodeproj` on that Mac. Add your Apple Account in Xcode Settings and select your team in Signing & Capabilities. The build script prepares `Resources/library-ca.der` from the server public CA.
3. Select the connected iPhone as the run destination and press Run. For a command-line build, set `DEVELOPMENT_TEAM` and run `bash build.sh device`.
4. Open Reading Partner on the phone and allow local network access. Choose a configured address reachable from the phone. For first pairing, the Mac owner can view the dedicated code with `cat ~/ReadingPartner/data/apple-iphone.pair`. Sign in to the reading account after pairing.

For a simulator on this Mac, use the loopback host. `python3 enroll.py --simulator` creates a separate simulator code. After installing the simulator app, copy `~/ReadingPartner/data/apple-simulator.pair` into `tmp/simulator.pair` in its data container and launch it. The simulator consumes the file once.
