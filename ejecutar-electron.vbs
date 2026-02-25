Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Obtener el directorio del script
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Cambiar al directorio del script
objShell.CurrentDirectory = strScriptPath

' Verificar si node_modules existe
If Not objFSO.FolderExists(strScriptPath & "\node_modules") Then
    ' Instalar dependencias en ventana minimizada
    objShell.Run "cmd /c cd /d """ & strScriptPath & """ && npm install && npm install electron --save-dev", 2, False
    WScript.Sleep 8000
End If

' Verificar si Electron está instalado (verificar si existe el archivo)
strElectronPath = strScriptPath & "\node_modules\.bin\electron.cmd"
If Not objFSO.FileExists(strElectronPath) Then
    objShell.Run "cmd /c cd /d """ & strScriptPath & """ && npm install electron --save-dev", 2, False
    WScript.Sleep 5000
End If

' Ejecutar Electron sin mostrar consola
If objFSO.FileExists(strElectronPath) Then
    objShell.Run """" & strElectronPath & """ .", 0, False
Else
    ' Si no existe, intentar ejecutar npm run electron
    objShell.Run "cmd /c cd /d """ & strScriptPath & """ && npm run electron", 0, False
End If
