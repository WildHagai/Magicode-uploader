#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <strsafe.h>
#include <new>

#pragma comment(lib, "shlwapi.lib")

static HMODULE g_hModule = NULL;
static long g_cRef = 0;

// Read the config file to get node path and main.js path
static BOOL ReadConfig(WCHAR* nodePath, DWORD nodePathSize, WCHAR* mainJsPath, DWORD mainJsSize) {
    WCHAR dllDir[MAX_PATH];
    GetModuleFileNameW(g_hModule, dllDir, MAX_PATH);
    PathRemoveFileSpecW(dllDir);

    WCHAR configPath[MAX_PATH];
    StringCchPrintfW(configPath, MAX_PATH, L"%s\\magicode-config.json", dllDir);

    HANDLE hFile = CreateFileW(configPath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return FALSE;

    char buf[4096];
    DWORD bytesRead = 0;
    ReadFile(hFile, buf, sizeof(buf) - 1, &bytesRead, NULL);
    CloseHandle(hFile);
    buf[bytesRead] = '\0';

    // Simple JSON parse for "nodePath" and "mainJsPath"
    auto extractValue = [](const char* json, const char* key, WCHAR* out, DWORD outSize) -> BOOL {
        char searchKey[128];
        StringCchPrintfA(searchKey, 128, "\"%s\"", key);
        const char* keyPos = strstr(json, searchKey);
        if (!keyPos) return FALSE;
        const char* colon = strchr(keyPos + strlen(searchKey), ':');
        if (!colon) return FALSE;
        const char* startQuote = strchr(colon + 1, '"');
        if (!startQuote) return FALSE;
        startQuote++;
        const char* endQuote = strchr(startQuote, '"');
        if (!endQuote) return FALSE;

        // Copy and unescape backslashes
        char temp[MAX_PATH * 2];
        int ti = 0;
        for (const char* p = startQuote; p < endQuote && ti < (int)sizeof(temp) - 1; p++) {
            if (*p == '\\' && *(p + 1) == '\\') {
                temp[ti++] = '\\';
                p++;
            } else {
                temp[ti++] = *p;
            }
        }
        temp[ti] = '\0';
        MultiByteToWideChar(CP_UTF8, 0, temp, -1, out, outSize);
        return TRUE;
    };

    if (!extractValue(buf, "nodePath", nodePath, nodePathSize)) return FALSE;
    if (!extractValue(buf, "mainJsPath", mainJsPath, mainJsSize)) return FALSE;
    return TRUE;
}

// {7B3F2E41-1D5A-4F6E-9C8B-2A3D4E5F6071}
static const CLSID CLSID_MagicodeUpload =
    { 0x7B3F2E41, 0x1D5A, 0x4F6E, { 0x9C, 0x8B, 0x2A, 0x3D, 0x4E, 0x5F, 0x60, 0x71 } };

class MagicodeUploadCommand : public IExplorerCommand {
    long m_cRef;
public:
    MagicodeUploadCommand() : m_cRef(1) { InterlockedIncrement(&g_cRef); }
    ~MagicodeUploadCommand() { InterlockedDecrement(&g_cRef); }

    // IUnknown
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
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
    STDMETHODIMP GetTitle(IShellItemArray* psiItemArray, LPWSTR* ppszName) {
        return SHStrDupW(L"Upload to Magicode", ppszName);
    }

    STDMETHODIMP GetIcon(IShellItemArray* psiItemArray, LPWSTR* ppszIcon) {
        return SHStrDupW(L"imageres.dll,112", ppszIcon);
    }

    STDMETHODIMP GetToolTip(IShellItemArray* psiItemArray, LPWSTR* ppszInfotip) {
        return SHStrDupW(L"Upload file(s) to send.magicode.me", ppszInfotip);
    }

    STDMETHODIMP GetCanonicalName(GUID* pguidCommandName) {
        *pguidCommandName = CLSID_MagicodeUpload;
        return S_OK;
    }

    STDMETHODIMP GetState(IShellItemArray* psiItemArray, BOOL fOkToBeSlow, EXPCMDSTATE* pCmdState) {
        *pCmdState = ECS_ENABLED;
        return S_OK;
    }

    STDMETHODIMP Invoke(IShellItemArray* psiItemArray, IBindCtx* pbc) {
        if (!psiItemArray) return E_INVALIDARG;

        WCHAR nodePath[MAX_PATH];
        WCHAR mainJsPath[MAX_PATH];
        if (!ReadConfig(nodePath, MAX_PATH, mainJsPath, MAX_PATH)) return E_FAIL;

        // Build command line: node "main.js" "file1" "file2" ...
        WCHAR cmdLine[32768];
        StringCchPrintfW(cmdLine, 32768, L"\"%s\" \"%s\"", nodePath, mainJsPath);

        DWORD count = 0;
        psiItemArray->GetCount(&count);
        for (DWORD i = 0; i < count; i++) {
            IShellItem* psi = NULL;
            if (SUCCEEDED(psiItemArray->GetItemAt(i, &psi))) {
                LPWSTR filePath = NULL;
                if (SUCCEEDED(psi->GetDisplayName(SIGDN_FILESYSPATH, &filePath))) {
                    StringCchCatW(cmdLine, 32768, L" \"");
                    StringCchCatW(cmdLine, 32768, filePath);
                    StringCchCatW(cmdLine, 32768, L"\"");
                    CoTaskMemFree(filePath);
                }
                psi->Release();
            }
        }

        STARTUPINFOW si = { sizeof(si) };
        PROCESS_INFORMATION pi = {};
        CreateProcessW(NULL, cmdLine, NULL, NULL, FALSE,
            CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
        if (pi.hProcess) CloseHandle(pi.hProcess);
        if (pi.hThread) CloseHandle(pi.hThread);

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
    MagicodeClassFactory() : m_cRef(1) {}

    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
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

BOOL WINAPI DllMain(HINSTANCE hInstance, DWORD dwReason, LPVOID lpReserved) {
    if (dwReason == DLL_PROCESS_ATTACH) {
        g_hModule = hInstance;
        DisableThreadLibraryCalls(hInstance);
    }
    return TRUE;
}

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
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

STDAPI DllRegisterServer() { return S_OK; }
STDAPI DllUnregisterServer() { return S_OK; }

} // extern "C"
