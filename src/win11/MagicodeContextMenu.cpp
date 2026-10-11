#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <strsafe.h>
#include <new>
#include <string>
#include <vector>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "ole32.lib")

static HMODULE g_hModule = NULL;
static long g_cRef = 0;

// "Upload to Magicode" on files and folders.
// {7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}
static const CLSID CLSID_MagicodeUpload =
    { 0x7B3F2E41, 0x1D5A, 0x4F6E, { 0x9C, 0x8B, 0x2A, 0x3D, 0x4E, 0x5F, 0x60, 0x71 } };

// "Magicode: recent links" submenu on a folder's (or the desktop's) background.
// {7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6072}
static const CLSID CLSID_MagicodeRecent =
    { 0x7B3F2E41, 0x1D5A, 0x4F6E, { 0x9C, 0x8B, 0x2A, 0x3D, 0x4E, 0x5F, 0x60, 0x72 } };

// --- Text -------------------------------------------------------------------

// Hebrew when Windows is displayed in Hebrew; MAGICODE_LANG=en|he overrides it (tests).
static bool Hebrew() {
    WCHAR lang[8] = L"";
    if (GetEnvironmentVariableW(L"MAGICODE_LANG", lang, 8) > 0) return wcscmp(lang, L"he") == 0;
    return PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_HEBREW;
}

static const wchar_t* T(const wchar_t* en, const wchar_t* he) { return Hebrew() ? he : en; }

// --- Helpers ----------------------------------------------------------------

static std::wstring ModuleDir() {
    std::vector<WCHAR> buf(32768);
    DWORD len = GetModuleFileNameW(g_hModule, buf.data(), (DWORD)buf.size());
    std::wstring path(buf.data(), len);
    size_t slash = path.find_last_of(L'\\');
    return slash == std::wstring::npos ? path : path.substr(0, slash);
}

static bool FileExists(const std::wstring& path) {
    DWORD attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

static void ShowError(const wchar_t* message) {
    MessageBoxW(NULL, message, L"Magicode Uploader", MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
}

static std::wstring FromUtf8(const std::string& s) {
    if (s.empty()) return std::wstring();
    int len = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), NULL, 0);
    std::wstring w(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &w[0], len);
    return w;
}

static std::string ToUtf8(const std::wstring& w) {
    if (w.empty()) return std::string();
    int len = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), NULL, 0, NULL, NULL);
    std::string s(len, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), &s[0], len, NULL, NULL);
    return s;
}

// Starts MagicodeUploader.exe (installed next to this DLL) with the given arguments.
static HRESULT LaunchUploader(const std::wstring& args) {
    std::wstring exePath = ModuleDir() + L"\\MagicodeUploader.exe";
    if (!FileExists(exePath)) {
        ShowError(T(L"MagicodeUploader.exe is missing. Please reinstall Magicode Uploader.",
                    L"הקובץ MagicodeUploader.exe חסר. התקינו מחדש את Magicode Uploader."));
        return E_FAIL;
    }

    std::wstring cmd = L"\"" + exePath + L"\" " + args;
    std::vector<WCHAR> cmdLine(cmd.begin(), cmd.end());
    cmdLine.push_back(L'\0');

    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi = {};
    if (!CreateProcessW(NULL, cmdLine.data(), NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        DWORD error = GetLastError();
        ShowError(T(L"Could not start MagicodeUploader.exe.", L"לא ניתן להפעיל את MagicodeUploader.exe."));
        return HRESULT_FROM_WIN32(error);
    }
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return S_OK;
}

// Collects the file-system paths of the selected items (skips virtual items).
static std::vector<std::wstring> SelectedPaths(IShellItemArray* items) {
    std::vector<std::wstring> paths;
    DWORD count = 0;
    if (!items || FAILED(items->GetCount(&count))) return paths;
    for (DWORD i = 0; i < count; i++) {
        IShellItem* psi = NULL;
        if (SUCCEEDED(items->GetItemAt(i, &psi))) {
            LPWSTR path = NULL;
            if (SUCCEEDED(psi->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
                paths.push_back(path);
                CoTaskMemFree(path);
            }
            psi->Release();
        }
    }
    return paths;
}

// Writes the paths, one per line in UTF-8, to a temp file that the uploader reads
// (and deletes). This avoids the 32K command-line limit on big selections.
static bool WriteListFile(const std::vector<std::wstring>& paths, std::wstring& listPath) {
    WCHAR tempDir[MAX_PATH + 1];
    if (!GetTempPathW(MAX_PATH + 1, tempDir)) return false;
    GUID guid;
    CoCreateGuid(&guid);
    WCHAR name[64];
    StringCchPrintfW(name, 64, L"magicode-%08lX%04X%04X.txt", guid.Data1, guid.Data2, guid.Data3);
    listPath = std::wstring(tempDir) + name;

    std::string utf8;
    for (const auto& p : paths) {
        utf8 += ToUtf8(p);
        utf8 += '\n';
    }

    HANDLE h = CreateFileW(listPath.c_str(), GENERIC_WRITE, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_TEMPORARY, NULL);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    BOOL ok = WriteFile(h, utf8.data(), (DWORD)utf8.size(), &written, NULL);
    CloseHandle(h);
    if (!ok || written != utf8.size()) {
        DeleteFileW(listPath.c_str());
        return false;
    }
    return true;
}

// --- Recent links -----------------------------------------------------------

struct RecentLink {
    std::wstring title;  // "report.pdf (14:32)"
    std::wstring url;
};

// "2026-10-11T13:29:03Z" (UTC) -> "14:32" today, or the short date and time otherwise.
static std::wstring FormatWhen(const std::wstring& utc) {
    SYSTEMTIME st = {};
    if (swscanf_s(utc.c_str(), L"%hu-%hu-%huT%hu:%hu:%hu", &st.wYear, &st.wMonth, &st.wDay,
            &st.wHour, &st.wMinute, &st.wSecond) != 6) return L"";
    SYSTEMTIME local, now;
    if (!SystemTimeToTzSpecificLocalTime(NULL, &st, &local)) return L"";
    GetLocalTime(&now);

    WCHAR date[64] = L"", time[64] = L"";
    GetTimeFormatEx(LOCALE_NAME_USER_DEFAULT, TIME_NOSECONDS, &local, NULL, time, 64);
    if (local.wYear == now.wYear && local.wMonth == now.wMonth && local.wDay == now.wDay) return time;
    GetDateFormatEx(LOCALE_NAME_USER_DEFAULT, DATE_SHORTDATE, &local, NULL, date, 64, NULL);
    return std::wstring(date) + L" " + time;
}

// Reads recent.txt, written by MagicodeUploader.exe next to this DLL: newest first,
// one "<UTC time>\t<file name>\t<link>" line per upload.
static std::vector<RecentLink> ReadRecentLinks() {
    std::vector<RecentLink> links;
    HANDLE h = CreateFileW((ModuleDir() + L"\\recent.txt").c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) return links;
    std::string data(64 * 1024, '\0');
    DWORD read = 0;
    ReadFile(h, &data[0], (DWORD)data.size(), &read, NULL);
    CloseHandle(h);
    data.resize(read);

    std::wstring text = FromUtf8(data);
    size_t start = 0;
    while (start < text.size() && links.size() < 10) {
        size_t end = text.find(L'\n', start);
        if (end == std::wstring::npos) end = text.size();
        std::wstring line = text.substr(start, end - start);
        start = end + 1;
        if (!line.empty() && line.back() == L'\r') line.pop_back();

        size_t tab1 = line.find(L'\t');
        size_t tab2 = tab1 == std::wstring::npos ? std::wstring::npos : line.find(L'\t', tab1 + 1);
        if (tab2 == std::wstring::npos) continue;
        std::wstring name = line.substr(tab1 + 1, tab2 - tab1 - 1);
        std::wstring url = line.substr(tab2 + 1);
        // Only links; nothing that could break out of the quoted command-line argument.
        if (url.compare(0, 8, L"https://") != 0 && url.compare(0, 7, L"http://") != 0) continue;
        if (url.find_first_of(L"\" ") != std::wstring::npos) continue;

        if (name.size() > 40) name = name.substr(0, 39) + L"…";
        std::wstring when = FormatWhen(line.substr(0, tab1));
        links.push_back({ when.empty() ? name : name + L" (" + when + L")", url });
    }
    return links;
}

// --- Commands ---------------------------------------------------------------

// Shared IUnknown and defaults for the commands below.
class CommandBase : public IExplorerCommand {
    long m_cRef;
public:
    CommandBase() : m_cRef(1) { InterlockedIncrement(&g_cRef); }
    virtual ~CommandBase() { InterlockedDecrement(&g_cRef); }

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IExplorerCommand) {
            *ppv = static_cast<IExplorerCommand*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&m_cRef); }
    STDMETHODIMP_(ULONG) Release() {
        long c = InterlockedDecrement(&m_cRef);
        if (c == 0) delete this;
        return c;
    }

    STDMETHODIMP GetIcon(IShellItemArray*, LPWSTR* ppszIcon) { *ppszIcon = NULL; return E_NOTIMPL; }
    STDMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszInfotip) { *ppszInfotip = NULL; return E_NOTIMPL; }
    STDMETHODIMP GetCanonicalName(GUID* pguidCommandName) { *pguidCommandName = GUID_NULL; return S_OK; }
    STDMETHODIMP GetState(IShellItemArray*, BOOL, EXPCMDSTATE* pCmdState) { *pCmdState = ECS_ENABLED; return S_OK; }
    STDMETHODIMP GetFlags(EXPCMDFLAGS* pFlags) { *pFlags = ECF_DEFAULT; return S_OK; }
    STDMETHODIMP EnumSubCommands(IEnumExplorerCommand** ppEnum) { *ppEnum = NULL; return E_NOTIMPL; }
};

class UploadCommand : public CommandBase {
public:
    STDMETHODIMP GetTitle(IShellItemArray*, LPWSTR* ppszName) {
        return SHStrDupW(T(L"Upload to Magicode", L"העלאה ל-Magicode"), ppszName);
    }
    STDMETHODIMP GetIcon(IShellItemArray*, LPWSTR* ppszIcon) {
        return SHStrDupW(L"imageres.dll,112", ppszIcon);
    }
    STDMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszInfotip) {
        return SHStrDupW(T(L"Upload file(s) to send.magicode.me", L"העלאת קבצים ל-send.magicode.me"), ppszInfotip);
    }
    STDMETHODIMP GetCanonicalName(GUID* pguidCommandName) {
        *pguidCommandName = CLSID_MagicodeUpload;
        return S_OK;
    }
    STDMETHODIMP GetState(IShellItemArray* psiItemArray, BOOL, EXPCMDSTATE* pCmdState) {
        // Hide the command for selections with nothing on disk (e.g. items
        // inside a zip, Recycle Bin, network locations without a path).
        *pCmdState = SelectedPaths(psiItemArray).empty() ? ECS_HIDDEN : ECS_ENABLED;
        return S_OK;
    }
    STDMETHODIMP Invoke(IShellItemArray* psiItemArray, IBindCtx*) {
        std::vector<std::wstring> paths = SelectedPaths(psiItemArray);
        if (paths.empty()) return E_INVALIDARG;

        std::wstring listPath;
        if (!WriteListFile(paths, listPath)) {
            ShowError(T(L"Could not write the list of selected files to the temp folder.",
                        L"לא ניתן לכתוב את רשימת הקבצים שנבחרו לתיקייה הזמנית."));
            return E_FAIL;
        }
        HRESULT hr = LaunchUploader(L"--list \"" + listPath + L"\"");
        if (FAILED(hr)) DeleteFileW(listPath.c_str());
        return hr;
    }
};

// One entry of the recent-links submenu: copies its link again.
class RecentLinkCommand : public CommandBase {
    RecentLink m_link;
    bool m_placeholder;
public:
    RecentLinkCommand(const RecentLink& link, bool placeholder) : m_link(link), m_placeholder(placeholder) {}

    STDMETHODIMP GetTitle(IShellItemArray*, LPWSTR* ppszName) { return SHStrDupW(m_link.title.c_str(), ppszName); }
    STDMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszInfotip) {
        if (m_placeholder) { *ppszInfotip = NULL; return E_NOTIMPL; }
        return SHStrDupW(m_link.url.c_str(), ppszInfotip);
    }
    STDMETHODIMP GetState(IShellItemArray*, BOOL, EXPCMDSTATE* pCmdState) {
        *pCmdState = m_placeholder ? ECS_DISABLED : ECS_ENABLED;
        return S_OK;
    }
    STDMETHODIMP Invoke(IShellItemArray*, IBindCtx*) {
        if (m_placeholder) return S_OK;
        return LaunchUploader(L"--copy \"" + m_link.url + L"\"");
    }
};

class CommandEnum : public IEnumExplorerCommand {
    long m_cRef;
    std::vector<IExplorerCommand*> m_items;
    ULONG m_next;
public:
    explicit CommandEnum(const std::vector<IExplorerCommand*>& items) : m_cRef(1), m_items(items), m_next(0) {
        InterlockedIncrement(&g_cRef);
        for (auto* c : m_items) c->AddRef();
    }
    ~CommandEnum() {
        for (auto* c : m_items) c->Release();
        InterlockedDecrement(&g_cRef);
    }

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IEnumExplorerCommand) {
            *ppv = static_cast<IEnumExplorerCommand*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&m_cRef); }
    STDMETHODIMP_(ULONG) Release() {
        long c = InterlockedDecrement(&m_cRef);
        if (c == 0) delete this;
        return c;
    }

    STDMETHODIMP Next(ULONG celt, IExplorerCommand** pUICommand, ULONG* pceltFetched) {
        ULONG fetched = 0;
        while (fetched < celt && m_next < m_items.size()) {
            pUICommand[fetched] = m_items[m_next++];
            pUICommand[fetched]->AddRef();
            fetched++;
        }
        if (pceltFetched) *pceltFetched = fetched;
        return fetched == celt ? S_OK : S_FALSE;
    }
    STDMETHODIMP Skip(ULONG celt) {
        m_next = (ULONG)min((size_t)m_next + celt, m_items.size());
        return m_next < m_items.size() ? S_OK : S_FALSE;
    }
    STDMETHODIMP Reset() { m_next = 0; return S_OK; }
    STDMETHODIMP Clone(IEnumExplorerCommand** ppenum) {
        CommandEnum* e = new (std::nothrow) CommandEnum(m_items);
        if (!e) return E_OUTOFMEMORY;
        e->m_next = m_next;
        *ppenum = e;
        return S_OK;
    }
};

class RecentCommand : public CommandBase {
public:
    STDMETHODIMP GetTitle(IShellItemArray*, LPWSTR* ppszName) {
        return SHStrDupW(T(L"Magicode: recent links", L"Magicode: קישורים אחרונים"), ppszName);
    }
    STDMETHODIMP GetIcon(IShellItemArray*, LPWSTR* ppszIcon) {
        return SHStrDupW(L"imageres.dll,112", ppszIcon);
    }
    STDMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszInfotip) {
        return SHStrDupW(T(L"Copy a link to an earlier upload again", L"העתקה מחדש של קישור להעלאה קודמת"), ppszInfotip);
    }
    STDMETHODIMP GetCanonicalName(GUID* pguidCommandName) {
        *pguidCommandName = CLSID_MagicodeRecent;
        return S_OK;
    }
    STDMETHODIMP GetFlags(EXPCMDFLAGS* pFlags) { *pFlags = ECF_HASSUBCOMMANDS; return S_OK; }
    STDMETHODIMP Invoke(IShellItemArray*, IBindCtx*) { return S_OK; }

    STDMETHODIMP EnumSubCommands(IEnumExplorerCommand** ppEnum) {
        *ppEnum = NULL;
        std::vector<RecentLink> links = ReadRecentLinks();
        bool placeholder = links.empty();
        if (placeholder) links.push_back({ T(L"No uploads yet", L"עדיין אין העלאות"), L"" });

        std::vector<IExplorerCommand*> items;
        for (const auto& link : links) {
            RecentLinkCommand* c = new (std::nothrow) RecentLinkCommand(link, placeholder);
            if (c) items.push_back(c);
        }
        CommandEnum* e = new (std::nothrow) CommandEnum(items);
        for (auto* c : items) c->Release();  // the enumerator holds its own references
        if (!e) return E_OUTOFMEMORY;
        *ppEnum = e;
        return S_OK;
    }
};

// --- Class factory and exports ---------------------------------------------

class MagicodeClassFactory : public IClassFactory {
    long m_cRef;
    CLSID m_clsid;
public:
    explicit MagicodeClassFactory(REFCLSID clsid) : m_cRef(1), m_clsid(clsid) { InterlockedIncrement(&g_cRef); }
    ~MagicodeClassFactory() { InterlockedDecrement(&g_cRef); }

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IClassFactory) {
            *ppv = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = NULL;
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&m_cRef); }
    STDMETHODIMP_(ULONG) Release() {
        long c = InterlockedDecrement(&m_cRef);
        if (c == 0) delete this;
        return c;
    }

    STDMETHODIMP CreateInstance(IUnknown* pUnkOuter, REFIID riid, void** ppv) {
        if (!ppv) return E_POINTER;
        *ppv = NULL;
        if (pUnkOuter) return CLASS_E_NOAGGREGATION;
        CommandBase* pCmd = m_clsid == CLSID_MagicodeRecent
            ? static_cast<CommandBase*>(new (std::nothrow) RecentCommand())
            : static_cast<CommandBase*>(new (std::nothrow) UploadCommand());
        if (!pCmd) return E_OUTOFMEMORY;
        HRESULT hr = pCmd->QueryInterface(riid, ppv);
        pCmd->Release();
        return hr;
    }

    STDMETHODIMP LockServer(BOOL fLock) {
        if (fLock) InterlockedIncrement(&g_cRef);
        else InterlockedDecrement(&g_cRef);
        return S_OK;
    }
};

extern "C" {

BOOL WINAPI DllMain(HINSTANCE hInstance, DWORD dwReason, LPVOID) {
    if (dwReason == DLL_PROCESS_ATTACH) {
        g_hModule = hInstance;
        DisableThreadLibraryCalls(hInstance);
    }
    return TRUE;
}

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = NULL;
    if (rclsid != CLSID_MagicodeUpload && rclsid != CLSID_MagicodeRecent) return CLASS_E_CLASSNOTAVAILABLE;
    MagicodeClassFactory* pFactory = new (std::nothrow) MagicodeClassFactory(rclsid);
    if (!pFactory) return E_OUTOFMEMORY;
    HRESULT hr = pFactory->QueryInterface(riid, ppv);
    pFactory->Release();
    return hr;
}

STDAPI DllCanUnloadNow() {
    return g_cRef == 0 ? S_OK : S_FALSE;
}

// Registration is done by the sparse package (Win11) or scripts\register-win11.ps1.
STDAPI DllRegisterServer() { return S_OK; }
STDAPI DllUnregisterServer() { return S_OK; }

} // extern "C"
