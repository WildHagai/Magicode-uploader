Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory of this script
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Read config to get node path
configPath = scriptDir & "\win11\build\magicode-config.json"
If Not fso.FileExists(configPath) Then
    ' Fallback: use node from PATH
    nodePath = "node.exe"
Else
    Set configFile = fso.OpenTextFile(configPath, 1)
    configText = configFile.ReadAll
    configFile.Close
    ' Extract nodePath from JSON
    startPos = InStr(configText, """nodePath""")
    If startPos > 0 Then
        startPos = InStr(startPos, configText, ": """) + 3
        endPos = InStr(startPos, configText, """")
        nodePath = Mid(configText, startPos, endPos - startPos)
        nodePath = Replace(nodePath, "\\", "\")
    Else
        nodePath = "node.exe"
    End If
End If

mainJs = scriptDir & "\main.js"

' Build command
Dim cmd
cmd = """" & nodePath & """ """ & mainJs & """"

For i = 0 To WScript.Arguments.Count - 1
    cmd = cmd & " """ & WScript.Arguments(i) & """"
Next

' Run hidden (0 = hide window, False = don't wait)
shell.Run cmd, 0, False
