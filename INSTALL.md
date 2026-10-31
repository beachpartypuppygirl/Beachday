# Installing Beachday

Beachday doesn't have an installer. It's one file you download and run, so there's nothing to
set up and nothing to uninstall but the file itself.

## Windows

1. Download `Beachday-<version>-win.zip`.
2. **Before extracting:** right-click the zip, choose **Properties**, tick **Unblock** at the
   bottom of the General tab, and click **OK**.
3. Extract the zip anywhere you like, such as your Documents folder.
4. Open the folder and run **Beachday.exe**. Keep everything in the folder together. If you want
   a shortcut, right-click `Beachday.exe` and choose **Send to ▸ Desktop**.

**"Windows protected your PC"?** You skipped step 2, and that's fine. Click **More info**, then
**Run anyway**. Windows says this about software that hasn't paid for a signing certificate.

## Linux

1. Download `Beachday-<version>.AppImage`.
2. Let it run: right-click it, choose **Properties ▸ Permissions**, and allow it to run as a
   program. Or, in a terminal: `chmod +x Beachday-*.AppImage`
3. Double-click it.

**Nothing happens, or it mentions FUSE?** AppImages need FUSE 2. On Ubuntu 24.04 and later:
`sudo apt install libfuse2t64`. On older Ubuntu: `sudo apt install libfuse2`.

**It mentions the "SUID sandbox"?** Some systems restrict the sandbox Beachday's engine uses.
The quick way past it is to start Beachday from a terminal with `--no-sandbox` after its name.

## Updating

Replace the old file (or folder) with the new one. Your settings live elsewhere and stay put.

## Removing it

Delete the file (or folder). Your settings stay behind in case you come back. To remove those too:

- Windows: `%APPDATA%\beachday`
- Linux: `~/.config/beachday`

## Opening a playlist

Use **File ▸ Open Playlist…** in Beachday. Double-clicking a `.bday` file doesn't open it yet.
If you've been sent a playlist without its music, Beachday will help you find your own copies.

## Something went wrong?

**Help ▸ Open Log Folder** shows Beachday's log file. Send that to whoever gave you Beachday.
