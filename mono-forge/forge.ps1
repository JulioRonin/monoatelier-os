<#
.SYNOPSIS
    Atajos de Mono Forge para Windows. Encuentra Blender solo.

.EXAMPLE
    .\forge.ps1 build  projects\cocina-sage\project.json
    .\forge.ps1 render projects\cocina-sage\project.json -Muestras 64 -Vistas frontal_34
    .\forge.ps1 ver    projects\cocina-sage
    .\forge.ps1 docs   projects\cocina-sage
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('build', 'render', 'ver', 'docs', 'blender')]
    [string]$Comando,

    [Parameter(Position = 1)]
    [string]$Ruta,

    [string]$Escena   = 'cocina',
    [string]$Vistas   = 'frontal_34,frontal,detalle',
    [int]$Muestras    = 128,
    [string]$Res      = '1920x1080',
    [string]$BlenderExe = ''
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

function Buscar-Blender {
    if ($BlenderExe) {
        if (Test-Path $BlenderExe) { return $BlenderExe }
        throw "No existe el blender.exe indicado: $BlenderExe"
    }
    if ($env:BLENDER_PATH -and (Test-Path $env:BLENDER_PATH)) { return $env:BLENDER_PATH }

    $cmd = Get-Command blender.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # Instalaciones típicas: se toma la versión más reciente
    $candidatos = @(
        "$env:ProgramFiles\Blender Foundation\*\blender.exe",
        "${env:ProgramFiles(x86)}\Blender Foundation\*\blender.exe",
        "$env:LOCALAPPDATA\Programs\Blender Foundation\*\blender.exe",
        "$env:ProgramFiles\WindowsApps\BlenderFoundation*\blender.exe"
    )
    $encontrados = foreach ($p in $candidatos) {
        Get-ChildItem -Path $p -ErrorAction SilentlyContinue
    }
    if ($encontrados) {
        return ($encontrados | Sort-Object FullName -Descending | Select-Object -First 1).FullName
    }
    throw @"
No encontré blender.exe.
Instálalo desde https://www.blender.org/download/ o indica la ruta:
    .\forge.ps1 $Comando $Ruta -BlenderExe "C:\ruta\a\blender.exe"
o deja fija la variable:
    setx BLENDER_PATH "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"
"@
}

function Resolver-Json([string]$r) {
    if (-not $r) { throw "Falta la ruta al project.json o a la carpeta del proyecto." }
    if (Test-Path $r -PathType Container) {
        $j = Join-Path $r 'project.json'
        if (-not (Test-Path $j)) { throw "No hay project.json en $r" }
        return (Resolve-Path $j).Path
    }
    if (-not (Test-Path $r)) { throw "No existe: $r" }
    return (Resolve-Path $r).Path
}

switch ($Comando) {

    'blender' {
        Write-Host (Buscar-Blender)
    }

    'build' {
        $b = Buscar-Blender
        $json = Resolver-Json $Ruta
        Write-Host "Blender: $b" -ForegroundColor DarkGray
        & $b --background --python (Join-Path $raiz 'blender\build_from_json.py') -- $json
    }

    'render' {
        $b = Buscar-Blender
        $json = Resolver-Json $Ruta
        Write-Host "Blender: $b" -ForegroundColor DarkGray
        & $b --background --python (Join-Path $raiz 'blender\render.py') -- `
            $json --escena $Escena --vistas $Vistas --muestras $Muestras --res $Res
        $carpeta = Join-Path (Split-Path -Parent $json) 'deliverables\renders'
        if (Test-Path $carpeta) {
            Write-Host "`nRenders en $carpeta" -ForegroundColor Green
            Invoke-Item $carpeta
        }
    }

    # Abre el modelo en la INTERFAZ de Blender, para verlo y girarlo.
    'ver' {
        $b = Buscar-Blender
        $json = Resolver-Json $Ruta
        $blend = Join-Path (Split-Path -Parent $json) 'deliverables\modelo.blend'
        if (-not (Test-Path $blend)) {
            Write-Host "No hay modelo.blend todavía; construyéndolo…" -ForegroundColor Yellow
            & $b --background --python (Join-Path $raiz 'blender\build_from_json.py') -- $json
        }
        Write-Host "Abriendo $blend" -ForegroundColor Green
        Start-Process $b -ArgumentList "`"$blend`""
    }

    'docs' {
        $json = Resolver-Json $Ruta
        $dir = Split-Path -Parent $json
        python -m mono_forge.docs $dir
        Invoke-Item (Join-Path $dir 'deliverables')
    }
}
