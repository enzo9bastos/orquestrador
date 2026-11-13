// Orquestrador: window presence.
//
// Exposes org.orquestrador.Janelas.Estado(pids) on the session bus, at
// /org/orquestrador/Janelas (bus name org.gnome.Shell). The app passes its own
// process ids as a JSON array and gets back {"foco","visivel"}:
//   foco     "app" when one of its windows has focus, "nenhum" when nothing (or
//            the desktop) has focus, "outro" otherwise
//   visivel  an app window is on the current workspace, not minimized, and
//            other windows on top of it cover less than 70% of it
// Nothing about other windows (titles, apps) ever leaves the shell.
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const XML = `<node>
  <interface name="org.orquestrador.Janelas">
    <method name="Estado">
      <arg type="s" direction="in" name="pids"/>
      <arg type="s" direction="out" name="estado"/>
    </method>
  </interface>
</node>`;

const COBERTA = 0.7;
const TIPOS = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG, Meta.WindowType.UTILITY];

function fracaoCoberta(r, deCima) {
    if (!deCima.length || r.width <= 0 || r.height <= 0)
        return 0;
    const N = 20;
    let cobertos = 0;
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            const x = r.x + ((i + 0.5) * r.width) / N;
            const y = r.y + ((j + 0.5) * r.height) / N;
            if (deCima.some(o => x >= o.x && x < o.x + o.width && y >= o.y && y < o.y + o.height))
                cobertos++;
        }
    }
    return cobertos / (N * N);
}

export default class OrqJanelas extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this._dbus.export(Gio.DBus.session, '/org/orquestrador/Janelas');
    }

    disable() {
        this._dbus?.flush();
        this._dbus?.unexport();
        this._dbus = null;
    }

    Estado(pidsJson) {
        let pids = [];
        try {
            pids = JSON.parse(pidsJson).map(Number).filter(Number.isInteger).slice(0, 16);
        } catch {
            return JSON.stringify({erro: 'pids'});
        }
        const ehApp = w => pids.includes(w.get_pid());
        const area = global.workspace_manager.get_active_workspace();
        const focada = global.display.get_focus_window();
        const foco = !focada || !TIPOS.includes(focada.get_window_type()) ? 'nenhum' : ehApp(focada) ? 'app' : 'outro';

        const naArea = w => !w.minimized && TIPOS.includes(w.get_window_type()) &&
            (w.is_on_all_workspaces() || w.located_on_workspace(area));
        const pilha = global.display.sort_windows_by_stacking(
            global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).filter(naArea)); // bottom → top
        let i = -1;
        pilha.forEach((w, n) => {
            if (ehApp(w))
                i = n;
        });
        if (i < 0)
            return JSON.stringify({foco, visivel: false});
        const deCima = pilha.slice(i + 1).filter(w => !ehApp(w)).map(w => w.get_frame_rect());
        return JSON.stringify({foco, visivel: fracaoCoberta(pilha[i].get_frame_rect(), deCima) < COBERTA});
    }
}
