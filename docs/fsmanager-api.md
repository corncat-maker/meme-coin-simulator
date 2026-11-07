# FSManager API 文档

## chooseFileFromDisk

从磁盘选择文件。

**调用方式：**
```javascript
window.CandyJar.call('FSManager', 'chooseFileFromDisk', {}, successCallback, errorCallback)
```

**入参：**
- `params`: `{}` (空对象)

**返回值：**
- 成功：`{ success?: boolean, apFilePath?: string, ... }`
- 失败：错误对象

---

## uploadFile

上传文件。

**调用方式：**
```javascript
window.CandyJar.call('FSManager', 'uploadFile', param, successCallback, errorCallback)
```

**入参：**
- `params`: 
  ```typescript
  {
    apFilePath: string  // 文件路径
  }
  ```

**返回值：**
- 成功：`{ cloudId: string, ... }`
- 失败：错误对象

---

## downloadFile

下载文件。

**调用方式：**
```javascript
window.CandyJar.call('FSManager', 'downloadFile', param, successCallback, errorCallback)
```

**入参：**
- `params`: 
  ```typescript
  {
    url: string  // 文件URL或base64字符串
  }
  ```

**返回值：**
- 成功：`{ apFilePath?: string, ... }`
- 失败：错误对象

---

## saveFile

保存文件到磁盘。

**调用方式：**
```javascript
window.CandyJar.call('FSManager', 'saveFile', param, successCallback, errorCallback)
```

**入参：**
- `params`: 
  ```typescript
  {
    apFilePath: string,  // 文件路径
    toDisk: boolean      // 是否保存到磁盘
  }
  ```

**返回值：**
- 成功：`{ success?: boolean, ... }`
- 失败：错误对象

