declare module 'qz-tray' {
  interface QzConfig {
    margins?: number
    scaleContent?: boolean
    copies?: number
  }

  interface Qz {
    websocket: {
      connect(): Promise<void>
      isActive(): boolean
    }
    printers: {
      find(): Promise<string | string[]>
    }
    configs: {
      create(printer: string, options?: QzConfig): unknown
    }
    print(config: unknown, data: Array<{ type: 'raw'; format: 'command'; data: string }>): Promise<void>
  }

  const qz: Qz
  export default qz
}
