"""Guardar la llave sin editar el archivo a mano."""

from __future__ import annotations

from forge_agent import llave


def test_conserva_lo_demas_y_pone_la_llave_en_su_renglon(tmp_path):
    f = tmp_path / ".env.local"
    # la última línea sin salto: pegar al final la dejaría unida a la anon key
    f.write_bytes(b"VITE_SUPABASE_URL=https://x\r\nVITE_SUPABASE_ANON_KEY=eyJ.a.b")
    llave.guardar_llave("sk-ant-api03-nueva", str(f))
    assert f.read_text(encoding="utf-8").splitlines() == [
        "VITE_SUPABASE_URL=https://x",
        "VITE_SUPABASE_ANON_KEY=eyJ.a.b",
        "ANTHROPIC_API_KEY=sk-ant-api03-nueva",
    ]


def test_reemplaza_la_anterior_y_convierte_utf16(tmp_path):
    f = tmp_path / ".env.local"
    f.write_bytes("ANTHROPIC_API_KEY=sk-ant-...\r\nVITE_SUPABASE_URL=https://x\r\n"
                  .encode("utf-16"))
    llave.guardar_llave("sk-ant-api03-nueva", str(f))
    texto = f.read_text(encoding="utf-8")
    assert texto.count("ANTHROPIC_API_KEY=") == 1
    assert "sk-ant-..." not in texto and "VITE_SUPABASE_URL=https://x" in texto


def test_crea_el_archivo_si_no_existe(tmp_path):
    f = tmp_path / ".env.local"
    llave.guardar_llave("sk-ant-api03-nueva", str(f))
    assert f.read_text(encoding="utf-8") == "ANTHROPIC_API_KEY=sk-ant-api03-nueva\n"


def test_no_guarda_el_ejemplo_ni_una_llave_cortada(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(llave, "RAIZ", str(tmp_path))
    monkeypatch.setattr(llave, "guardar_llave",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("guardó")))
    assert llave.main(["x", "sk-ant-..."]) == 1
    assert llave.main(["x", "sk-ant-api03-corta"]) == 1
    assert "se cortó" in capsys.readouterr().out


def test_no_guarda_una_llave_rechazada(monkeypatch, capsys):
    monkeypatch.setattr(llave, "_verificar", lambda k: "Anthropic la rechazó.")
    monkeypatch.setattr(llave, "guardar_llave",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("guardó")))
    assert llave.main(["x", "sk-ant-api03-" + "a" * 95]) == 1
    assert "No la guardé" in capsys.readouterr().out
