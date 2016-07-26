'use strict';

import * as vscode from 'vscode';
import fs = require('fs');

const dgram = require('dgram');
const path = require('path');
const request = require('request');
const spawn = require('child_process').spawn;

const iotOutputChannel = vscode.window.createOutputChannel('IoT');

const appx = {
    "arm" : {
        "id": "NodeScriptHost_dnsz84vs3g3zp!App",
        "packageFullName": "NodeScriptHost_1.0.0.0_arm__dnsz84vs3g3zp",
        "package": "NodeScriptHost_1.0.0.0_ARM.appx",
        "certificate": "NodeScriptHost_1.0.0.0_ARM.cer",
        "dependencies": [
            "Microsoft.VCLibs.ARM.14.00.appx"
        ]
    },
    "x86" : {
        "id": "NodeScriptHost_dnsz84vs3g3zp!App",
        "packageFullName": "NodeScriptHost_1.0.0.0_x86__dnsz84vs3g3zp",
        "package": "NodeScriptHost_1.0.0.0_x86.appx",
        "certificate": "NodeScriptHost_1.0.0.0_x86.cer",
        "dependencies": [
            "Microsoft.VCLibs.x86.14.00.appx"
        ]
    },
    "x64" : {
        "id": "NodeScriptHost_dnsz84vs3g3zp!App",
        "packageFullName": "NodeScriptHost_1.0.0.0_x64__dnsz84vs3g3zp",
        "package": "NodeScriptHost_1.0.0.0_x64.appx",
        "certificate": "NodeScriptHost_1.0.0.0_x64.cer",
        "dependencies": [
            "Microsoft.VCLibs.x64.14.00.appx"
        ]
    }
};

const defaultSettings = {
    "iot" : {
        "Device" : {
            "IpAddress": "10.127.128.129",
            "DeviceName": "mydevice",
            "UserName": "Administrator",
            "Password": "p@ssw0rd",
            "ListFilter": "username_or_ipaddr_substr"
        },
        "Deployment" : {
            "Files": [
                "index.js",
                "package.json"
            ],
            "LaunchBrowserPageNo": "http://10.137.187.40:1337/"
        },
        "RunCommands": [
            "iotstartup list",
            "iotstartup add headless NodeScriptHost",
            "iotstartup remove headless NodeScriptHost",
            "deployappx getpackages|findstr -i nodescripthost",
            "deployappx uninstall NodeScriptHost_1.0.0.0_x86__dnsz84vs3g3zp",
            "dir c:\\data\\Users\\DefaultAccount\\AppData\\Local\\Packages\\NodeScriptHost_dnsz84vs3g3zp\\LocalState",
            "type c:\\data\\Users\\DefaultAccount\\AppData\\Local\\Packages\\NodeScriptHost_dnsz84vs3g3zp\\LocalState\\server.js",
            "type c:\\data\\Users\\DefaultAccount\\AppData\\Local\\Packages\\NodeScriptHost_dnsz84vs3g3zp\\LocalState\\package.json"
        ]
    }
}

const host_len = 33;
const ipv4_len = 4 * 4 + 1;
const mac_len = 3 * 8 + 1;
const id_len = 40;
const model_len = 50;
const version_len = 50;
const arch_len = 8;

const host_offset    = 0;
const ipv4_offset    = host_len;
const mac_offset     = host_len + ipv4_len;
const id_offset      = mac_offset + mac_len;
const model_offset   = id_offset + id_len;
const version_offset = model_offset + model_len;
const arch_offset    = version_offset + version_len;

class HostInfo
{
    public host :string;
    public seen :Number;
    public mac :string;
    public id :string;
    public model :string;
    public version :string;
    public arch :string;

    constructor(hostName :string, lastSeen :Number, mac :string, id :string, model :string, version :string, arch :string)
    {
        this.host = hostName;
        this.seen = lastSeen;
        this.mac = mac;
        this.id = id;
        this.model = model;
        this.version = version;
        this.arch = arch;
    }
}

export class IotDevice
{
    private host :string;
    private devName :string;
    private user :string;
    private password :string;
    private static listeningForEboot = false;
    private static iotDeviceList :Map<string, HostInfo>;
    
    constructor()
    {
    }

    public Init() : Thenable<boolean>
    {
        return this.GetHost().then((hostResult :string) => {
            this.host = hostResult;
            return this.GetDevName();
        }).then( (devName :string) => {
            this.devName = devName;
            return this.GetUserName();
        }).then( (userResult :string) => {
            this.user = userResult;
            return this.GetPassword();
        }).then( (passwordResult :string) => {
            this.password = passwordResult;
            return new Promise<boolean>((resolve, reject) => {
                resolve(true);
            })
        });
    }
    
    public ArchitectureFromDeviceInfo(info: any) :string
    {
        const osVersionTokens = info.OsVersion.split('.');
        const token2 = osVersionTokens[2];
        const architecture = token2.substr(0,token2.length-3);
        return architecture;
    }

    public GetDevName() : Thenable<string>
    {
        const config = vscode.workspace.getConfiguration('iot');
        const deviceName :string = config.get('Device.DeviceName', '');
        if (deviceName)
        {
            return new Promise<string> (function (resolve, reject){ 
                resolve(deviceName);
            });
        }
        else
        {
            return vscode.window.showInputBox({"placeHolder":"device name", "prompt":"Enter Device Name"});
        }
    }

    public GetHost() : Thenable<string>
    {
        const config = vscode.workspace.getConfiguration('iot');
        const host :string = config.get('Device.IpAddress', '');
        if (host)
        {
            return new Promise<string> (function (resolve, reject){ 
                resolve(host);
            });
        }
        else
        {
            return vscode.window.showInputBox({"placeHolder":"device ip address", "prompt":"Enter IP Address"});
        }
    }

    public GetUserName() : Thenable<string>
    {
        const config = vscode.workspace.getConfiguration('iot');
        const userName :string = config.get('Device.UserName', '');
        if (userName)
        {
            return new Promise<string> (function (resolve, reject){ 
                resolve(userName);
            });
        }
        else
        {
            return vscode.window.showInputBox({"placeHolder":"user name", "prompt":"Enter Device User Name"});
        }
    }
    
    public GetPassword() : Thenable<string>
    {
        const config = vscode.workspace.getConfiguration('iot');
        const password :string = config.get('Device.Password', '');
        if (password)
        {
            return new Promise<string> (function (resolve, reject){ 
                resolve(password);
            });
        }
        else
        {
            return vscode.window.showInputBox({"placeHolder":"password", "prompt":"Enter Device Password"});
        }
    }

    private FileFromPath(path :string) :string
    {
        const filename = path.replace(/^.*[\\\/]/, '');
        return filename;
    }
    
    public GetExtensionInfo()
    {
        const ext = vscode.extensions.getExtension('ms-iot.windowsiot');
        iotOutputChannel.show();
        iotOutputChannel.appendLine('ext.extensionPath=' + ext.extensionPath);
        //iotOutputChannel.appendLine('ext.exports=' + ext.exports);
        iotOutputChannel.appendLine('ext.id=' + ext.id);
        iotOutputChannel.appendLine('version='+ext.packageJSON.version);
        iotOutputChannel.appendLine('');
    }
    
    public GetDeviceInfo() : Thenable<any>
    {
        return new Promise<any>( (resolve, reject) =>
        {
            const url = 'http://' + this.host + ':8080/api/os/info';
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            request.get(url, param, function (err, resp, body) {
                if (!err && resp.statusCode === 200) 
                {
                    const info = JSON.parse(body);
                    resolve(info);
                }
                else
                { 
                    if (err)
                    {
                        console.log(err.message);
                        iotOutputChannel.appendLine(err.message);
                        iotOutputChannel.appendLine( '' );
                    }
                    else if (resp && resp.statusCode !== 200)
                    {
                        const info = JSON.parse(body);
                        iotOutputChannel.appendLine(info.Reason + ' status=' + resp.statusCode);
                        iotOutputChannel.appendLine( '' );
                    }
                } 
            });
        });
    }

    public GetAppxInfo(architecture: string) : Thenable<any>
    {
        return new Promise<any>( (resolve, reject) =>
        {
            let appxDetail: any;
            if (architecture === "x86")
            {
                appxDetail = appx.x86;
            }
            else if (architecture === "amd64")
            {
                appxDetail = appx.x64;
            }
            else if (architecture === "arm")
            {
                appxDetail = appx.arm;
            }

            if (appxDetail !== null)
            {
                console.log( 'architecture=' + architecture );
                console.log( 'package=' + appxDetail.package );
                console.log( 'certificate=' + appxDetail.certificate );
                console.log( 'dependencies=' );
                appxDetail.dependencies.forEach(dep => {
                    console.log( "  " + dep );
                });
                console.log( '' );
                resolve(appxDetail);
            }
            else
            {
                iotOutputChannel.appendLine('Platform not recognized');
                reject('Platform not recognized');
            }

        });
    }
    
    public PrintDeviceInfo(info: any)
    {
        iotOutputChannel.show();
        iotOutputChannel.appendLine('Get Device Info:');
        iotOutputChannel.appendLine( 'Device=' + this.host );
        iotOutputChannel.appendLine( 'ComputerName=' + info.ComputerName );
        iotOutputChannel.appendLine( 'Language=' + info.Language );
        iotOutputChannel.appendLine( 'OsEdition=' + info.OsEdition );
        iotOutputChannel.appendLine( 'OsEditionId=' + info.OsEditionId );
        iotOutputChannel.appendLine( 'OsVersion=' + info.OsVersion );
        iotOutputChannel.appendLine( 'Platform=' + info.Platform );
        iotOutputChannel.appendLine( '' );
    }

    public PrintMessage(message :string)
    {
        iotOutputChannel.show();
        iotOutputChannel.appendLine(message);        
    }

    public GetDeviceName(maxRetries :number) :Promise<any>
    {
        return new Promise<any>( (resolve, reject) =>
        {
            const url = 'http://' + this.host + ':8080/api/os/machinename';
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            let retries = maxRetries;

            (function GetDeviceNameCallback(){
                request.get(url, param, function (err, resp, body) {
                    if (!err && resp.statusCode === 200) 
                    {
                        const info = JSON.parse(body);
                        let message = `Get Device Name:\nDevice=${this.host}\nComputerName=${info.ComputerName}\n`; 
                        resolve(message);
                    }
                    else 
                    {
                        --retries;
                        if (retries < 0)
                        {
                            if (err){
                                console.log(err.message);
                                reject(err.message);
                            }
                            else if (resp && resp.statusCode !== 200)
                            {
                                const info = JSON.parse(body);
                                const message = info.Reason + ' status=' + resp.statusCode;
                                reject(message);
                            }
                        }
                        setTimeout(GetDeviceNameCallback, 1000);
                    }
                });
            })();
        });
    }
    
    public static ListDevicesCallback()
    {
        iotOutputChannel.appendLine("List IoT Devices");
        const spaces = '                                                                           ';
        let col1 = 0;
        let hostWidth = 0;
        let modelWidth = 0;
        
        // remove devices which haven't been seen recently
        const maxAge = 10*1000;
        let ageThreshold = Number(new Date()) - maxAge;
        IotDevice.iotDeviceList.forEach( (info :HostInfo, index :string, map :Map<string,HostInfo>) =>
        {
            if(info.seen < ageThreshold)
            {
                map.delete(index);      
            }
        });

        // adjust col1 width
        IotDevice.iotDeviceList.forEach( (info, index, map) =>
        {
            col1 = (col1>index.length)?col1:index.length;
        });
        col1 = (spaces.length < col1+2)?spaces.length:(col1+2);

        // adjust host width
        IotDevice.iotDeviceList.forEach( (info, index, map) =>
        {
            hostWidth = (hostWidth>info.host.length)?hostWidth:info.host.length;
        });
        hostWidth = (spaces.length < hostWidth+2)?spaces.length:(hostWidth+2);

        // adjust model width
        IotDevice.iotDeviceList.forEach( (info, index, map) =>
        {
            modelWidth = (modelWidth>info.model.length)?modelWidth:info.model.length;
        });
        modelWidth = (spaces.length < modelWidth+2)?spaces.length:(modelWidth+2);

        IotDevice.iotDeviceList.forEach( (info, index, map) =>
        {
            col1 = (col1>index.length)?col1:index.length;
        });
        col1 = (spaces.length < col1+2)?spaces.length:(col1+2);

        const config = vscode.workspace.getConfiguration('iot');
        let deviceFilter :string = config.get('Device.ListFilter', '');
        iotOutputChannel.show();
        IotDevice.iotDeviceList.forEach( (info, index, map) =>
        {
            if (!deviceFilter ||
                ((index.indexOf(deviceFilter) >= 0) ||  (IotDevice.iotDeviceList.get(index).host.indexOf(deviceFilter) >= 0)))
            {
                iotOutputChannel.append(index)
                iotOutputChannel.append(spaces.substr(0, col1-index.length));
                iotOutputChannel.append(map.get(index).host);
                iotOutputChannel.append(spaces.substr(0, hostWidth-map.get(index).host.length));
                iotOutputChannel.append(map.get(index).model);
                iotOutputChannel.append(spaces.substr(0, modelWidth-map.get(index).model.length));
                iotOutputChannel.append(map.get(index).arch);
                iotOutputChannel.append(spaces.substr(0, arch_len-map.get(index).arch.length));
                iotOutputChannel.append(map.get(index).mac);
                iotOutputChannel.append(spaces.substr(0, mac_len-map.get(index).mac.length));
                //iotOutputChannel.append(map.get(index).id);
                //iotOutputChannel.append(spaces.substr(0, id_len-map.get(index).id.length));
                // iotOutputChannel.append(map.get(index).version);
                // iotOutputChannel.append(spaces.substr(0, version_len-map.get(index).version.length));
                iotOutputChannel.appendLine('');
            }
        });
        iotOutputChannel.appendLine('');
    }

    public static ListDevices()
    {
        // if the list is empty wait 3 seconds,
        // otherwise this doesn't work if it's the first command
        if (IotDevice.iotDeviceList.size === 0)
        {
            iotOutputChannel.show();
            iotOutputChannel.appendLine('Initializing device list...\n')
        }
        setTimeout(IotDevice.ListDevicesCallback, (IotDevice.iotDeviceList.size > 0)?0:10*1000);
    }

    private static UnpackEbootBuffer (buffer :Uint8Array)
    {
        let data = new Buffer(buffer);
        let s = data.toString( 'ucs2');

        let host = s.substr(host_offset, host_len);
        let i = host.indexOf('\0');
        host = host.substr(0,i);
        
        let ipv4 = s.substr(ipv4_offset, ipv4_len);
        i = ipv4.indexOf('\0');
        ipv4 = ipv4.substr(0,i);

        let mac = s.substr(mac_offset, mac_len);
        i = mac.indexOf('\0');
        mac = mac.substr(0,i);

        let id = s.substr(id_offset, id_len);
        i = id.indexOf('\0');
        id = id.substr(0,i);

        let model = s.substr(model_offset, model_len);
        i = model.indexOf('\0');
        model = model.substr(0,i);

        let version = s.substr(version_offset, version_len);
        i = version.indexOf('\0');
        version = version.substr(0,i);

        let arch = s.substr(arch_offset, arch_len);
        i = arch.indexOf('\0');
        arch = arch.substr(0,i);

        IotDevice.iotDeviceList.set(ipv4, new HostInfo(host, Number(new Date()), mac, id, model, version, arch));
    }

    public static ListenEbootPinger()
    {
        if (!IotDevice.listeningForEboot)
        {
            IotDevice.listeningForEboot = true;
            IotDevice.iotDeviceList = new Map<string, HostInfo>();

            const s = dgram.createSocket('udp4');
            s.on('listening', function(){
                var address = s.address();
                console.log('UDP Client listening on ' + address.address + ":" + address.port);
            });

            s.on('message', function(message, remote){
                IotDevice.UnpackEbootBuffer(message);
            });

            s.bind(6, () => {
                s.setBroadcast(true);
                s.setMulticastTTL(128);
                s.addMembership('239.0.0.222');
            });
        };
    }

    public SetDeviceName() : Thenable<any>
    {
        return new Promise<any>( (resolve, reject) =>
        {
            const url = 'http://' + this.host + ':8080/api/iot/device/name?newdevicename=' + new Buffer(this.devName).toString('base64');
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            iotOutputChannel.show();
            request.post(url, param, function (err, resp, body) {
                if (!err && resp.statusCode === 200) 
                {
                    iotOutputChannel.appendLine(`Set Device Name succeeded!`);
                    iotOutputChannel.appendLine( '' );
                    resolve(resp);
                }
                else
                {
                    if (err){
                        iotOutputChannel.appendLine(err.message);
                        iotOutputChannel.appendLine( '' );
                        reject(err);
                    }

                    if (resp.statusCode !== 200)
                    {
                        const info = JSON.parse(body);
                        iotOutputChannel.appendLine(info.Reason + ' status=' + resp.statusCode);
                        iotOutputChannel.appendLine( '' );
                        reject(resp);
                    }
                }
            });
        });                   
    }
    
    public RestartDevice()
    {
        return new Promise<any>( (resolve, reject) =>
        {       
            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            iotOutputChannel.show();
            const restarturl = 'http://' + this.host + ':8080/api/control/restart';
            request.post(restarturl, param, function (err, resp, body) {
                if (!err && resp.statusCode === 200) 
                {
                    iotOutputChannel.appendLine(`Restarting device...`)
                    iotOutputChannel.appendLine( '' );
                    resolve(resp);
                }
                else 
                {   if (err)
                    {
                        console.log(err.message);
                        iotOutputChannel.appendLine(err.message);
                        iotOutputChannel.appendLine( '' );
                        reject(err);
                    }
                }
            });
        });
    }
    
    private UploadFileToPackage(packageFullName :any, filename: string) :Promise<string>
    {
        return new Promise<string> ((resolve, reject) => {
            let relPath = path.relative(vscode.workspace.rootPath, filename);
            let relDir = path.dirname(relPath);
            let remotePath = '\\LocalState'
            console.log ('filename='+filename);
            console.log ('relDir=' + relDir);
            if (relDir !== '.')
            {
                remotePath = remotePath + '\\' + relDir;
            }
            console.log ('remotePath=' + remotePath);

            let longRemotePath = 'c:\\data\\Users\\DefaultAccount\\AppData\\Local\\Packages\\NodeScriptHost_dnsz84vs3g3zp' + remotePath;
            console.log ('longRemotePath=' + longRemotePath);

            //this.RunCommand(`if not exist ${longRemotePath} md ${longRemotePath}`, true)
            this.RunCommand(`md ${longRemotePath}`, true)
            .then((message) => {
                if (message)
                {
                    iotOutputChannel.appendLine(message);
                }

                const url = 'http://' + this.host + ':8080/api/filesystem/apps/file?knownfolderid=LocalAppData&packagefullname=' + packageFullName + '&path=' + remotePath;
                console.log ('url=' + url);

                const param = {'auth': {
                    'user': this.user,
                    'pass': this.password
                }};

                const req = request.post(url, param, function (err, resp, body) {
                    if (err){
                        console.error(err.message);
                        reject(err.message);
                    } 
                    else if (resp.statusCode !== 200)
                    {
                        let message = `ERROR: File upload failed: ${filename}\n`;
                        if (resp.body.length > 0)
                        {
                            const info = JSON.parse(body);
                            message = message + `Reason=${info.Reason}\nstatusCode=${resp.statusCode}`;
                        }
                        else if (resp.statusMessage.length > 0)
                        {
                            message = message + `Reason=${resp.statusMessage}\nstatusCode=${resp.statusCode}`;
                        }

                        console.error(message);
                        resolve(message);
                    }
                    else 
                    {
                        resolve(relPath);
                    }
                }, function(err){
                    console.error(err);                    
                });
                const form = req.form();
                form.append('file', fs.createReadStream(filename));
            })
        })
    }

    public FindFilesToUpload() :Promise<any>
    {
        return new Promise<any> ((resolve,reject) => {
            iotOutputChannel.appendLine('Locating files to upload in workspace.');

            const config = vscode.workspace.getConfiguration('iot');
            let files :any = config.get('Deployment.Files', '');
            if (!files)
            {
                // todo - get "main" from package.json?
                reject("Please specify files to upload in settings.json - iot.Deployment.Files")
            }
            
            let foundFiles = [];
            Promise.all(files.map(item => {
                return vscode.workspace.findFiles(`${item}`, "");
            }))
            .then((result :vscode.Uri[][]) =>{
                for (let i=0;i<result.length;i++)
                {
                    for (let j=0;j<result[i].length;j++)
                    {
                        foundFiles.push(result[i][j]);
                    }
                }

                let vscode_dir_cmd = 'dir c:\\data\\Users\\DefaultAccount\\AppData\\Local\\Packages\\NodeScriptHost_dnsz84vs3g3zp\\LocalState /s/b';
                this.RunCommand(vscode_dir_cmd, false)
                .then((output) =>{
                    let installedFiles = output.split("\r\n");
                    installedFiles.forEach((file, index, array) => {
                        array[index] = file.replace("c:\\data\\Users\\DefaultAccount\\AppData\\Local\\Packages\\NodeScriptHost_dnsz84vs3g3zp\\LocalState\\", "");
                    });
                    let foundFilesFiltered = foundFiles.filter((uri,index,array) => {
                        let relpath = path.relative(vscode.workspace.rootPath, uri.fsPath);
                        if (relpath.indexOf("node_modules") < 0){ 
                            return true;
                        }
                        return !installedFiles.find((value, index, array) => { 
                            if(value===relpath) {
                                return true;
                            } else {

                            return false; }
                        });
                    })
                    resolve(foundFilesFiltered);
                })                
            }, function(err){
                iotOutputChannel.appendLine("ERROR: err");
            })
        });
    }

    public UploadWorkspaceFiles()
    {
        iotOutputChannel.show();
        iotOutputChannel.appendLine('Upload Workspace Files:');

        let architecture :string;
        let iotAppxDetail :any;
        let hostInstalled = false;

        return this.GetDeviceInfo().then((info) => {
            architecture = this.ArchitectureFromDeviceInfo(info);
            return this.GetAppxInfo(architecture);
        })
        .then ((appxDetail: any) => {
            iotAppxDetail = appxDetail;
            return this.GetPackages();
        })
        .then ((info: any) => {
            hostInstalled = IotDevice.IsInstalled(info, iotAppxDetail.id);
            return this.InstallPackage(iotAppxDetail, architecture, hostInstalled);
        })
        .then((resp: any) => {
            return this.WaitForAppxInstall(iotAppxDetail.id, hostInstalled);
        })
        .then((info: any) => {
            return this.FindFilesToUpload();
        })
        .then((uri :vscode.Uri[]) => {
            let chain :Promise<string> = null;
            uri.forEach(iotFile => {
                if (!chain)
                {
                    chain = this.UploadFileToPackage(iotAppxDetail.packageFullName, iotFile.fsPath);
                }
                else
                {
                    chain = chain.then((message) =>{
                        iotOutputChannel.appendLine( '  ' + message );
                        return this.UploadFileToPackage(iotAppxDetail.packageFullName, iotFile.fsPath);
                    }, function (err){ 
                        iotOutputChannel.appendLine(err);
                        iotOutputChannel.appendLine( '' );                        
                    });
                }
            })
            iotOutputChannel.appendLine( '\nUploading files:' );
            return chain;
        }).then((message) => {
            iotOutputChannel.appendLine( message );
            iotOutputChannel.appendLine( 'Upload Complete\n' );
        }, function(err){
            iotOutputChannel.appendLine(err);
            iotOutputChannel.appendLine( '' );
        })
    }

    public GetPackages()
    {
        return new Promise<any>( (resolve, reject) =>
        {
            const url = 'http://' + this.host + ':8080/api/appx/packagemanager/packages';
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            request.get(url, param, function (err, resp, body) {
                if (err){
                    console.log(err.message);
                    iotOutputChannel.appendLine(err.message);
                    reject(err);
                } else {
                    const info = JSON.parse(body);
                    resolve(info);
                }
            });
        });
    }

    public PrintPackages(info: any)
    {
        iotOutputChannel.show();
        iotOutputChannel.appendLine( 'Get Installed Packages:');
        iotOutputChannel.appendLine( 'Device=' + this.host );
        iotOutputChannel.appendLine( '');
        info.InstalledPackages.forEach(element => {
            iotOutputChannel.appendLine( 'Name: ' + element.Name );
            iotOutputChannel.appendLine( 'PackageFamilyName: ' + element.PackageFamilyName);
            iotOutputChannel.appendLine( 'PackageFullName: ' + element.PackageFullName);
            iotOutputChannel.appendLine( 'PackageOrigin: ' + element.PackageOrigin);
            iotOutputChannel.appendLine( 'PackageRelativeId: ' + element.PackageRelativeId);
            iotOutputChannel.appendLine( 'Publisher: ' + element.Publisher);
            element.RegisteredUsers.forEach(user =>{
            iotOutputChannel.appendLine( 'UserDisplayName: ' + user.UserDisplayName);
            iotOutputChannel.appendLine( 'Name: ' + user.UserSID); 
            });
            iotOutputChannel.appendLine( 'Version: ' + element.Version.Build + '.' + element.Version.Major + '.' + element.Version.Minor);
            iotOutputChannel.appendLine( '');
        });
    }

    public GetProcessInfo()
    {
        return new Promise<any>( (resolve, reject) =>
        {
            const url = 'http://' + this.host + ':8080/api/resourcemanager/processes';
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            request.get(url, param, function (err, resp, body) {
                if (err){
                    console.log(err.message);
                    iotOutputChannel.appendLine(err.message);
                } else {
                    const info = JSON.parse(body);
                    resolve(info);
                }
            });
        });
    }
    
    private OpenSettingsJson() :Promise<vscode.TextEditor>
    {
        return new Promise<vscode.TextEditor> ((resolve, reject) => {
            vscode.workspace.findFiles(".vscode/settings.json","",1)
            .then((results) =>{
                results.forEach( r => {
                    iotOutputChannel.appendLine(`opening ${r}`);
                    vscode.workspace.openTextDocument(r)
                    .then((doc:any) =>{
                        iotOutputChannel.appendLine(`success:${doc}`);
                        vscode.window.showTextDocument(doc).then((editor :vscode.TextEditor)=>{
                            resolve(editor);
                        })
                    })
                })
            }, (err) =>{
                reject(err);
            });
        })
    }

    public InitSettings() :Promise<string>
    {
        return new Promise((resolve,reject) => {
            let settingsJson = vscode.workspace.rootPath + "/" + ".vscode/settings.json";
            console.log(`settings.json=${settingsJson}`);

            fs.exists(settingsJson, (exists) =>{
                if (exists)
                {
                    this.OpenSettingsJson()
                    .then((editor :vscode.TextEditor) => {
                        let content = editor.document.getText();
                        console.info(content);
                        let settings :any = null;
                        try{
                            settings = JSON.parse(content);
                        }
                        catch(ex){
                            iotOutputChannel.appendLine(ex);
                        }
                        if (!settings)
                        {
                            settings = defaultSettings;
                            let newSettings = JSON.stringify(settings, null, 2);
                            console.info(newSettings);
                            editor.edit( (edit :vscode.TextEditorEdit ) => {
                                //edit.delete(null);
                                edit.insert(new vscode.Position(0,0), newSettings);
                            })
                            .then((result :boolean) =>{
                                if (result)
                                {
                                    editor.document.save();
                                }
                            })
                        };
                    })   
                }
                else
                {
                    fs.writeFile(settingsJson, JSON.stringify(defaultSettings, null, 2), (err) => {
                        if (err)
                        {
                            reject(err)
                        }
                        else
                        {
                            this.OpenSettingsJson()
                            .then((editor :vscode.TextEditor) => {
                                resolve ('settings.json created');
                            })
                        }
                    });                    
                }
            });
        });
    }

    public GetWorkspaceInfo()
    {
        iotOutputChannel.show();
        iotOutputChannel.appendLine(`rootpath=${vscode.workspace.rootPath}`);
        vscode.workspace.findFiles("**/*","",null,null)
        .then((result :any) =>{
            result.forEach( r => {
                iotOutputChannel.appendLine(r);
            });
            iotOutputChannel.appendLine('');
        })
    }

    public PrintProcessInfo(info: any, appxOnly: boolean)
    {
        iotOutputChannel.show();
        if (appxOnly){
            iotOutputChannel.appendLine( 'Get APPX Process Info:');
        }
        else{
            iotOutputChannel.appendLine( 'Get Process Info:');
            iotOutputChannel.appendLine( 'Device=' + this.host );
            iotOutputChannel.appendLine( '');
        }
        info.Processes.forEach(proc => {
            if (!appxOnly || proc.PackageFullName) 
            {
                if (proc.AppName) { iotOutputChannel.appendLine( 'AppName: ' + proc.AppName ) };
                if (proc.PackageFullName) { iotOutputChannel.appendLine( 'PackageFullName: ' + proc.PackageFullName ) };
                if (!appxOnly)
                {              
                    if (proc.IsRunning) { iotOutputChannel.appendLine( 'IsRunning: ' + proc.IsRunning ) };
                    if (proc.Publisher) { iotOutputChannel.appendLine( 'Publisher: ' + proc.Publisher ) };
                    if (proc.Version) { iotOutputChannel.appendLine( 'Version: ' + proc.Version.Major + '.' + proc.Version.Minor + '.' + proc.Version.Revision + '.' + proc.Version.Build) };
                    iotOutputChannel.appendLine( 'CPUUsage: ' + proc.CPUUsage );
                    iotOutputChannel.appendLine( 'ImageName: ' + proc.ImageName );
                    iotOutputChannel.appendLine( 'PageFileUsage: ' + proc.PageFileUsage );
                    iotOutputChannel.appendLine( 'PrivateWorkingSet: ' + proc.PrivateWorkingSet );
                    iotOutputChannel.appendLine( 'ProcessId: ' + proc.ProcessId );
                    iotOutputChannel.appendLine( 'SessionId: ' + proc.SessionId );
                    iotOutputChannel.appendLine( 'UserName: ' + proc.UserName );
                    iotOutputChannel.appendLine( 'VirtualSize: ' + proc.VirtualSize );
                    iotOutputChannel.appendLine( 'WorkingSetSize: ' + proc.WorkingSetSize );
                }
                iotOutputChannel.appendLine( '');
            }
        });
    }
    
    private InstallPackage(appxInfo :any, architecture :string, hostInstalled :boolean) :Promise<any>
    {
        return new Promise<any> ((resolve, reject) => {
            iotOutputChannel.show();
            if (hostInstalled)
            {
                iotOutputChannel.appendLine('NodeScriptHost is already installed');
                resolve(null);
                return;
            }

            const ext = vscode.extensions.getExtension('ms-iot.windowsiot');
            const appxFolder = ext.extensionPath + '\\appx\\' + architecture + '-appx\\';
            console.log('ext.extensionPath=' + ext.extensionPath);           

            const appxPath = appxFolder + appxInfo.package;
            const appxFile = this.FileFromPath(appxFolder + appxInfo.package);
            const certPath = appxFolder + appxInfo.certificate;
            const certFile = this.FileFromPath(appxFolder + appxInfo.certificate);

            const url = 'http://' + this.host + ':8080/api/appx/packagemanager/package?package=' + appxFile;
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            iotOutputChannel.appendLine('Installing Appx Package...');
            console.log('appxPath='+appxPath);
            console.log('appxFile='+appxFile);
            console.log('certPath='+certPath);
            console.log('certFile='+certFile);

            const req = request.post(url, param, function (err, resp, body) {
                if (err){
                    console.log(err.message);
                    iotOutputChannel.appendLine(err.message);
                    iotOutputChannel.appendLine( '' );
                    reject(err);
                } else {
                    if (resp.statusCode === 200)
                    {
                        iotOutputChannel.appendLine(`Successfully installed ${appxFile}`);
                        resolve(resp);
                    }
                    else if (resp.statusCode === 202)
                    {
                        const info = JSON.parse(body);
                        console.log(info.Reason);
                        console.log('status=' + resp.statusCode);
                        resolve(resp);
                    }
                    else
                    {
                        iotOutputChannel.appendLine('message=' + resp.statusMessage);
                        iotOutputChannel.appendLine('status=' + resp.statusCode);
                        reject(resp);
                    }
                    console.log( '' );
                }
            });
            const form = req.form();
            
            form.append(appxFile, fs.createReadStream(appxPath));
            form.append(certFile, fs.createReadStream(certPath));
            appxInfo.dependencies.forEach(dependency => {
                const depFile = this.FileFromPath(appxFolder + dependency);
                const depPath = appxFolder + dependency;
                console.log('depFile='+depFile);
                console.log('depPath='+depPath);
                form.append(depFile, fs.createReadStream(depPath));
            })
        });
    }

    public RunCommandInternal(command, resolve, reject, quiet)
    {
        if (!quiet)
        {
            iotOutputChannel.show();
            iotOutputChannel.appendLine(`Run ${command}`)
        }

        const url = 
            'http://' + this.host + 
            ':8080/api/iot/processmanagement/runcommandwithoutput?command=' + new Buffer(command).toString('base64') + 
            '&runasdefaultaccount=' + new Buffer('false').toString('base64') +
            '&timeout='  + new Buffer('300000').toString('base64');
        console.log ('url=' + url)

        const param = {'auth': {
            'user': this.user,
            'pass': this.password
        }};

        request.post(url, param, function (err, resp, body) {
            if (err){
                console.log(err.message);
                reject(err.message);
            }
            else if (resp.statusCode !== 200)
            {
                let message = `command=${command}\nstatusMessage=${resp.statusMessage}\nstatusCode=${resp.statusCode}\n`;
                console.error(message);
                resolve(message);
            } 
            else {
                const info = JSON.parse(body);
                if (!quiet)
                {
                    resolve(info.output);
                }
                else
                {
                    resolve(null);
                }
            }
        });
    }

    public RunCommandFromPrompt()
    {
        return new Promise<any> ((resolve,reject) => {
            vscode.window.showInputBox({"placeHolder":"command to run", "prompt":"Enter Command to Run"})
            .then((command) =>{
                this.RunCommandInternal(command, resolve, reject, false);
            });
        });
    }

    public RunCommandFromSettings()
    {
        return new Promise<any> ((resolve,reject) => {
            const config = vscode.workspace.getConfiguration('iot');
            let commands :any = config.get('RunCommands', '');
            if (!commands)
            {
                commands = 
                [
                    "tlist", 
                    "deployappx getpackages"
                ];
            }
            vscode.window.showQuickPick(commands)
            .then((command) =>{
                this.RunCommandInternal(command, resolve, reject, false);
            });
        });
    }
    
    public RunCommand(command :string, quiet :boolean) :Promise<string>
    {
        return new Promise<any> ((resolve, reject) => {
            this.RunCommandInternal(command, resolve, reject, quiet);
        });
    }

    public static IsInstalled(info:any, PackageRelativeId: string) : boolean
    {
        let installed = false;
        info.InstalledPackages.some(appx => {
            if (PackageRelativeId === appx.PackageRelativeId)
            {
                installed = true;
                return installed;
            }
        });
        return installed;
    }

    public static IsRunning(info :any, PackageFullName :string) :boolean
    {
        let running = false;
        info.Processes.some(proc => {
            if (PackageFullName === proc.PackageFullName)
            {
                running = true;
                return running;
            }
        });
        return running;
    }

    public RunRemoteScript()
    {
        let architecture: string;
        let iotAppxDetail :any;
        let hostInstalled = false;
        let hostRunning = false;

        iotOutputChannel.show();
        iotOutputChannel.appendLine('Run Remote Script:');

        return this.GetDeviceInfo().then((info) => {
            architecture = this.ArchitectureFromDeviceInfo(info);
            return this.GetAppxInfo(architecture);
        })
        .then ((appxDetail) => {
            iotAppxDetail = appxDetail;
            return this.GetPackages();
        })
        .then ((info: any) => {
            hostInstalled = IotDevice.IsInstalled(info, iotAppxDetail.id);
            return this.InstallPackage(iotAppxDetail, architecture, hostInstalled);
        })
        .then((resp: any) => {
            return this.WaitForAppxInstall(iotAppxDetail.id, hostInstalled);
        })
        .then((info: any) => {
            return this.GetProcessInfo();
        })
        .then((info :any) => {
            hostRunning = IotDevice.IsRunning(info, iotAppxDetail.packageFullName);
            iotOutputChannel.appendLine(hostRunning?'Stopping NodeScriptHost...':'NodeScriptHost is not running.');
            return this.StopAppx(iotAppxDetail.packageFullName, hostRunning)
        })
        .then((resp :any) => {
            return this.WaitForAppxStop(iotAppxDetail.packageFullName, hostRunning);
        })
        .then((message: string) => {
            if (message)
            {
                iotOutputChannel.appendLine(message);
            }
            return this.FindFilesToUpload();
        })
        .then((uri :vscode.Uri[]) => {
            return Promise.all(uri.map(iotFile => {
                iotOutputChannel.appendLine(`Uploading file ${iotFile.fsPath} ...`);
                return this.UploadFileToPackage(iotAppxDetail.packageFullName, iotFile.fsPath);
            }));
        }).then((messages) => {
            messages.map(message =>{
                iotOutputChannel.appendLine(`Successfully uploaded ${message}`)
            })
            iotOutputChannel.appendLine('Starting NodeScriptHost...');
            return this.ActivateApplication(iotAppxDetail.packageFullName);
        })
        .then((b: boolean) => {
            const config = vscode.workspace.getConfiguration('iot');
            let launchBrowserPage = config.get('Deployment.LaunchBrowserPage', '');
            if (launchBrowserPage)
            {
                iotOutputChannel.appendLine(`Navigate to ${launchBrowserPage} in a browser\n`); // TODO: this uses a hardcoded port so it's a hack

                // launch browser (probably only works on windows)
                spawn('cmd.exe', ['/C', 'start', launchBrowserPage]);
            }
            else
            {
                iotOutputChannel.appendLine('Done.');
            }
        });
    }

    public ActivateApplication(packageFullName: string) : Thenable<any>
    {
        return new Promise ((resolve, reject) => {
            const url = 'http://' + this.host + ':8080/api/iot/appx/app?appid=' + new Buffer(packageFullName).toString('base64');
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            request.post(url, param, function (err, resp, body) {
                if (err){
                    reject(err);
                } else {
                    resolve(resp);
                }
            });
        });
    }
    
    public StartNodeScriptHost()
    {
        let iotAppxDetail :any;
        let architecture: string;

        iotOutputChannel.show();
        iotOutputChannel.appendLine('Start Node Script Host:');

        return this.GetDeviceInfo().then((info) => {
            architecture = this.ArchitectureFromDeviceInfo(info);
            return this.GetAppxInfo(architecture);
        }).then ((appxDetail) => {
            iotAppxDetail = appxDetail;
            iotOutputChannel.show();
            iotOutputChannel.appendLine(`Activating ${iotAppxDetail.packageFullName}`);
            return this.ActivateApplication(iotAppxDetail.packageFullName);
        }).then ((resp: any) => {
            iotOutputChannel.appendLine('Application Started');
            iotOutputChannel.appendLine( '' );
        }, function(err){
            console.log(err.message);
            iotOutputChannel.appendLine(err.message);
            iotOutputChannel.appendLine( '' );
        });
    }

    public StopAppx(packageFullName :string, hostRunning :boolean) : Thenable<any>
    {
        return new Promise<any> ((resolve, reject) =>{
            if (!hostRunning)
            {
                resolve(null);
                return;
            }

            // TODO: is this correct for headless apps?
            const url = 'http://' + this.host + ':8080/api/taskmanager/app?package=' + new Buffer(packageFullName).toString('base64');
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            request.delete(url, param, function (err, resp, body) {
                if (err){
                    reject(err);
                } else {
                    resolve(resp);
                }
            });
        });
    }

    public WaitForAppxInstall(PackageRelativeId: string, hostInstalled :boolean) : Promise<string>
    {
        return new Promise<any>((resolve, reject) => {
            if (hostInstalled)
            {
                resolve(null);
                return;
            }
            
            const url = 'http://' + this.host + ':8080/api/appx/packagemanager/packages';
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            (function WaitForAppxInstallCallback(){
                request.get(url, param, function (err, resp, body) {
                    if (err){
                        console.log(err.message);
                        iotOutputChannel.appendLine(err.message);
                        reject(err);
                    } else {
                        const info = JSON.parse(body);
                        if (IotDevice.IsInstalled(info, PackageRelativeId))
                        {
                            resolve(info);
                        }
                        else
                        {
                            setTimeout(WaitForAppxInstallCallback, 1000);
                        }
                    }
                });
            })();
        });
    }

    public WaitForAppxStop(packageFullName :string, hostRunning :boolean) : Promise<string>
    {
        return new Promise<any>((resolve, reject) => {
            if (!hostRunning)
            {
                resolve(null);
                return;
            }

            const url = 'http://' + this.host + ':8080/api/resourcemanager/processes';
            console.log ('url=' + url)

            const param = {'auth': {
                'user': this.user,
                'pass': this.password
            }};

            (function WaitForAppxStopCallback(){
                request.get(url, param, function (err, resp, body) {
                    if (err){
                        console.log(err.message);
                        reject(err.message);
                    } else {
                        const info = JSON.parse(body);                      
                        if (IotDevice.IsRunning(info, packageFullName))
                        {
                            setTimeout(WaitForAppxStopCallback, 1000);
                        }
                        else
                        {
                            let message = `Done waiting for ${packageFullName}  to stop`;
                            resolve(message);
                        }
                    }
                });
            })();
        });
    }

    public StopNodeScriptHost() 
    {
        let architecture: string;

        return this.GetDeviceInfo().then((info) => {
            architecture = this.ArchitectureFromDeviceInfo(info);
            return this.GetAppxInfo(architecture);
        }).then ((appxDetail) => {
            iotOutputChannel.show();
            iotOutputChannel.appendLine(`Stopping ${appxDetail.packageFullName}`);
            return this.StopAppx(appxDetail.packageFullName, true);
        }).then ((resp: any) => {
            iotOutputChannel.appendLine('Application Stopped');
            iotOutputChannel.appendLine( '' );
        },function(err) {  
            console.log(err.message);
            iotOutputChannel.appendLine(err.message);
            iotOutputChannel.appendLine( '' );
        });
    }
}
