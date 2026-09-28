# RAJA Local Printer (Windows)

The companion app sends receipt data from the RAJA POS web app directly to the
Windows default printer as raw 58 mm ESC/POS text. It listens only on loopback
and only accepts browser requests from the production POS origin.

## Install on a cashier PC

1. Install the POS58 USB driver and add the printer in Windows.
2. Set POS58 as the Windows default printer and print a Windows test page.
3. In the repository's **Actions** tab, open **Build Windows local printer** and
   download the `RAJA-Local-Printer-win-x64` artifact after the workflow succeeds.
4. Extract the ZIP and run `RAJALocalPrinter.exe`. Keep the window running while
   using the POS. If Chrome asks for local network access, allow the RAJA POS
   site to connect to devices on the local network.
5. Open or reload the installed RAJA POS PWA and print a test receipt.

The helper has no installer or automatic startup registration. It runs as the
current Windows user and sends jobs to that user's default printer. Do not expose
its port (`17854`) beyond `127.0.0.1` or change the allowed browser origins
without reviewing the security implications.

## Build from source

Install the .NET 8 SDK on Windows, then run:

```powershell
dotnet publish local-printer/RAJALocalPrinter/RAJALocalPrinter.csproj `
  --configuration Release --runtime win-x64 --self-contained true `
  -p:PublishSingleFile=true --output local-printer/publish
```

## Printer limitations

This implementation expects the POS58 driver to accept raw ESC/POS data. The
receipt uses 32-character lines, CP437-safe ASCII text, and no automatic cutter
command. Some vendor drivers do not support raw printing; if a test page works
but the receipt does not, use the printer's raw/ESC-POS driver or SDK.
