#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p Resources
python3 ../../scripts/private_connection.py apple Resources/connection.json
openssl x509 -in "${RP_CA_PEM:-$HOME/ReadingPartner/tls/ca.pem}" -outform DER -out Resources/library-ca.der
args=(-project ReadingPartner.xcodeproj -scheme ReadingPartner -configuration Release -derivedDataPath "${RP_APP_BUILD:-$PWD/build}")
case "${1:-mac}" in
  mac) xcodebuild "${args[@]}" -destination 'platform=macOS,arch=arm64' CODE_SIGN_IDENTITY=- build ;;
  sim) xcodebuild "${args[@]}" -destination 'generic/platform=iOS Simulator' build ;;
  device) xcodebuild "${args[@]}" -destination 'generic/platform=iOS' DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:?Set your Apple development team ID}" -allowProvisioningUpdates build ;;
  device-check) xcodebuild "${args[@]}" -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build ;;
  *) exit 2 ;;
esac
