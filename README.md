# 



## Getting started
*Install dependencies*
```
npm install
```

*Build plugin*
```
npm run build
```

*Link plugin to Logi Plugin Service*
This command will create a symlink from the built plugin to the plugin folder of the Logi Plugin Service. The plugin should now be visible in the "All Actions" section of the device configuration screen in Options+
```
npm run link
```

*Unlink plugin from Logi Plugin Service*
Removes the symlink from the Logi Plugin Service. Plugin will no longer be visible in Options+
```
npm run unlink
```

## Package plugin
Create an .lplug4 file which can be used to distribute the plugin, or submit the plugin for the marketplace
```
npm run build:pack
```
