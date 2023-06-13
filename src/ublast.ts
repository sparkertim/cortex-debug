import { DebugProtocol } from '@vscode/debugprotocol';
import { GDBServerController, ConfigurationArguments, calculatePortMask, createPortName,SWOConfigureEvent } from './common';
import * as os from 'os';
import { EventEmitter } from 'events';
import internal = require('stream');

const commandExistsSync = require('command-exists').sync;
const EXECUTABLE_NAMES = ['nios2-gdb-server'];

/// jtag enum
/*
*
* error strings:
--------------------begin------------------------------
*1) USB-BlasterII [1-6.2]
*  Unable to read device chain - JTAG chain broken
*
*2) USB-BlasterII [1-6.3]
*  Unable to read device chain - JTAG chain broken
*
*-----------------------end-----------------------------
* normal strings:
*--------------------begin------------------------------
*1) USB-BlasterII [1-6.2]
*  02E120DD   10CX220Y
*
*2) USB-BlasterII [1-6.3]
*  031830DD   10M16S(A|C)
*
*-----------------------end-----------------------------
*/

/**
* nios2-gdb-server output
* start: 'Listening on port 50003 for connection from GDB: '
* conencted : 'Listening on port 50003 for connection from GDB: accepted'
*/
export class JtagChainInfo {
    valid:boolean;
    index:number;
    cableName:string;
    node:[string, string][] = [];
    error?:string;
    reason?:string;
    constructor(str: string){
        this.valid = true;
        this.parse(str);
    }

    private parse(str: string){
        var lines = str.split("\n");
        var regex_cable=/(\d+)\)\s+(.*)/;
        var regex_error=/(.*) - (.*)/;
        var regex_node=/\s+([0-9a-zA-Z]*)\s+([^\(\)]*)/;
        var tmp = lines[0].match(regex_cable);

        if(tmp != null)
        {
            this.index = Number(tmp[1]);
            this.cableName = String(tmp[2].trim());
        }
        
        for(let i = 1; i< lines.length; i++)
        {
            tmp = lines[i].match(regex_node);
            if(tmp != null)
            {
                this.node[i - 1] = [tmp[1], tmp[2]];
            }
            else if( (tmp = lines[i].match(regex_error)))
            {
                this.error = tmp[1];
                this.reason = tmp[2];
                this.valid = false;
            }
        }
    }
}

export class UBLastServerController extends EventEmitter implements GDBServerController {
    public portsNeeded: string[] = ['gdbPort', 'swoPort', 'consolePort'];
    public name: 'ublast';
    private args: ConfigurationArguments;
    private ports: { [name: string]: number };
    private cable: string;
    constructor() {
        super();
    }

    private cableMactch(str:string): void{
        var regex = /(\d+)\)\s+(.*)\n\n/g;
        var i: number = 0;
        var tmp = str.split("\n\n");
        let infos:JtagChainInfo[] = [];
        let matched_cable: string[] = [];
        for(let i = 0; i< tmp.length; i++)
        {
            if(tmp[i] != "")
            {
                infos.push(new JtagChainInfo(tmp[i]));
            }
        }

        infos?.forEach(
            (info, index, array) => {
                info.node.forEach(
                    (node, ind2, node_array) => {
                        if(info.valid && node[1].match(this.args.device) != null)
                        {
                            matched_cable.push(info.cableName);
                        }
                    }
                )
            }
        )
        this.cable = this.args.targetId == null? matched_cable[0] : Number(this.args.targetId) <= matched_cable.length? matched_cable[Number(this.args.targetId)]: matched_cable[0];
    }

    private getCable(){
        var exec = require('child_process').execSync;
        let tmp: String;
        let cable: string;
        if (os.platform() === 'win32') {
            tmp = "jtagconfig.exe";
        }
        else {
            tmp = "jtagconfig";
        }
       var rec = exec(tmp, {});
       this.cableMactch(String(rec));
    }

    public setPorts(ports: { [name: string]: number }): void {
        this.ports = ports;
    }

    public setArguments(args: ConfigurationArguments): void {
        this.args = args;
    }

    public customRequest(command: string, response: DebugProtocol.Response, args: any): boolean {
        return false;
    }
    
    public initCommands(): string[] {
        const gdbport = this.ports[createPortName(this.args.targetProcessor)];

        return [
            `target-select extended-remote localhost:${gdbport}`
        ];
    }

    public liveGdbInitCommands(): string[] {
        return this.initCommands();
    }

    public launchCommands(): string[] {
        const commands = [
            /*
            * nios2-gdb-server reset and halt nios2 when load.
            */
            'interpreter-exec console "load"',
        ];
        return commands;
    }

    public attachCommands(): string[] {
        const commands = [
            //'interpreter-exec console "monitor halt"',
        ];
        return commands;
    }

    public restartCommands(): string[] {
        const gdbport = this.ports[createPortName(this.args.targetProcessor)];
        const commands: string[] = [
            'interpreter-exec console "disconnect"',
            `target-select extended-remote localhost:${gdbport}`
        ];
        return commands;
    }

    public swoCommands(): string[] {
        return [];
    }

    private SWOConfigurationCommands(): string[] {
        return [];
    }

    public serverExecutable() {
        if (this.args.serverpath) { return this.args.serverpath; }
        else {
            if (os.platform() === 'win32') {
                return 'nios2-gdb-server.exe';
            }
            else {
                for (let name in EXECUTABLE_NAMES) {
                    if (commandExistsSync(EXECUTABLE_NAMES[name])) { return EXECUTABLE_NAMES[name]; }
                }
                return 'nios2-gdb-server';
            }
        }
    }
    
    public serverArguments(): string[] {
        const gdbport = this.ports['gdbPort'];

        let cmdargs = [
            //'-q',
            '--tcpport', gdbport.toString(),
            '-r',
            //'--tcpdebug',
            '--tcppersist'
        ];
        this.getCable();
        if(this.cable){
            cmdargs.push('-c', this.cable);
        }
        if (this.args.serverArgs) {
            cmdargs = cmdargs.concat(this.args.serverArgs);
        }

        return cmdargs;
    }

    public initMatch(): RegExp {
        return /Listening on port \d+ for connection from GDB\: /g;
    }

    public swoAndRTTCommands(): string[] {return []}
    public serverLaunchStarted(): void {}
    public serverLaunchCompleted(): void {}
    public debuggerLaunchStarted(): void {}
    public debuggerLaunchCompleted(): void {}
    public allocateRTTPorts(): Promise<void> {
        return Promise.resolve();
    }
}
