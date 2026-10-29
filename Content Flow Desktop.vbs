Option Explicit

Dim shell, fileSystem, root, electron
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
root = fileSystem.GetParentFolderName(WScript.ScriptFullName)
electron = root & "\node_modules\electron\dist\electron.exe"

If Not fileSystem.FileExists(electron) Then
  MsgBox "Chưa tìm thấy bộ chạy Content Flow Desktop. Hãy chạy npm install trong thư mục app rồi mở lại.", vbCritical, "Content Flow"
  WScript.Quit 1
End If

shell.CurrentDirectory = root
shell.Run Chr(34) & electron & Chr(34) & " " & Chr(34) & root & Chr(34), 0, False
