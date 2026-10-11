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

// {7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}
static const CLSID CLSID_MagicodeUpload =
    { 0x7B3F2E41, 0x1D5A, 0x4F6E, { 0x9C, 0x8B, 0x2A, 0x3D, 0x4E, 0x5F, 0x60, 0x71 } };

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

// MagicodeUploader.exe is installed next to this DLL.
static std::wstring UploaderPath() {
    return ModuleDir() + L"\\MagicodeUploader.exe";
}

static void ShowError(const wchar_t* message) {
    MessageBoxW(NULL, message, L"Magicode Uploader", MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
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
        int len = WideCharToMultiByte(CP_UTF8, 0, p.c_str(), (int)p.size(), NULL, 0, NULL, NULL);
        std::string s(len, '\0');
        WideCharToMultiByte(CP_UTF8, 0, p.c_str(), (int)p.size(), &s[0], len, NULL, NULL);
        utf8 += s;
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

class MagicodeUploadCommand : public IExplorerCommand {
    long m_cRef;
public:
    MagicodeUploadCommand() : m_cRef(1) { InterlockedIncrement(&g_cRef); }
    ~MagicodeUploadCommand() { InterlockedDecrement(&g_cRef); }

    // IUnknown
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

    // IExplorerCommand
    STDMETHODIMP GetTitle(IShellItemArray*, LPWSTR* ppszName) {
        return SHStrDupW(L"Upload to Magicode", ppszName);
    }

    STDMETHODIMP GetIcon(IShellItemArray*, LPWSTR* ppszIcon) {
        return SHStrDupW(L"imageres.dll,112", ppszIcon);
    }

    STDMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszInfotip) {
        return SHStrDupW(L"Upload file(s) to send.magicode.me", ppszInfotip);
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

        std::wstring exePath = UploaderPath();
        if (!FileExists(exePath)) {
            ShowError(L"MagicodeUploader.exe is missing. Please reinstall Magicode Uploader.");
            return E_FAIL;
        }

        std::wstring listPath;
        if (!WriteListFile(paths, listPath)) {
            ShowError(L"Could not write the list of selected files to the temp folder.");
            return E_FAIL;
        }

        std::wstring cmd = L"\"" + exePath + L"\" --list \"" + listPath + L"\"";
        std::vector<WCHAR> cmdLine(cmd.begin(), cmd.end());
        cmdLine.push_back(L'\0');

        STARTUPINFOW si = { sizeof(si) };
        PROCESS_INFORMATION pi = {};
        if (!CreateProcessW(NULL, cmdLine.data(), NULL, NULL, FALSE,
                CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
            DeleteFileW(listPath.c_str());
            ShowError(L"Could not start MagicodeUploader.exe to upload the selected files.");
            return HRESULT_FROM_WIN32(GetLastError());
        }
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        return S_OK;
    }

    STDMETHODIMP GetFlags(EXPCMDFLAGS* pFlags) {
        *pFlags = ECF_DEFAULT;
        return S_OK;
    }

    STDMETHODIMP EnumSubCommands(IEnumExplorerCommand** ppEnum) {
        *ppEnum = NULL;
        return E_NOTIMPL;
    }
};

class MagicodeClassFactory : public IClassFactory {
    long m_cRef;
public:
    MagicodeClassFactory() : m_cRef(1) { InterlockedIncrement(&g_cRef); }
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
        MagicodeUploadCommand* pCmd = new (std::nothrow) MagicodeUploadCommand();
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

// DLL exports
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
    if (rclsid != CLSID_MagicodeUpload) return CLASS_E_CLASSNOTAVAILABLE;
    MagicodeClassFactory* pFactory = new (std::nothrow) MagicodeClassFactory();
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
