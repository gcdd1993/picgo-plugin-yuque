const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'

module.exports = (ctx) => {
  const register = () => {
    ctx.helper.uploader.register('yuque', {
      handle,
      name: '语雀图床',
      config: config
    })
  }

  const postOptions = (baseUrl, cookie, docId, ctoken, image, fileName) => {
    return {
      method: 'POST',
      url: `${baseUrl}/api/upload/attach?attachable_type=Doc&attachable_id=${docId}&type=image&ocr=off&ctoken=${ctoken}`,
      headers: {
        'Content-Type': 'multipart/form-data',
        'Accept': 'text/javascript, text/html, application/xml, text/xml, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': baseUrl,
        'Referer': `${baseUrl}/`,
        'User-Agent': UA,
        'Cookie': cookie
      },
      simple: false,
      formData: {
        file: {
          value: image,
          options: {
            filename: fileName,
            contentType: null
          }
        }
      }
    }
  }

  // 上传接口的 ctoken 参数必须与 Cookie 里的 yuque_ctoken 一致，否则过不了 CSRF 校验
  const extractCtoken = (cookie) => {
    const matched = cookie.match(/yuque_ctoken=([^;]+)/)
    return matched ? matched[1] : ''
  }

  // 上传必须挂在某个文档下（attachable_id），文档数字 ID 只在文档页内嵌 JSON 里，没有轻量的查询接口
  const resolveDocId = async (docUrl, cookie) => {
    let url
    try {
      url = new URL(docUrl)
    } catch {
      throw new Error('文档链接格式不正确')
    }
    // Cookie 只发给语雀域
    if (url.hostname !== 'www.yuque.com' && !url.hostname.endsWith('.yuque.com')) {
      throw new Error('链接必须是语雀文档页（*.yuque.com）')
    }
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length < 3) {
      throw new Error('请填写具体文档的链接，形如 https://www.yuque.com/用户名/知识库/文档slug')
    }

    const page = await ctx.Request.request({
      method: 'GET',
      url: `${url.origin}/${pathParts[0]}/${pathParts[1]}/${pathParts[2]}`,
      headers: {
        'User-Agent': UA,
        'Cookie': cookie
      },
      resolveWithFullResponse: true,
      simple: false
    })
    if (page.statusCode === 401) {
      throw new Error('Cookie 已失效，请重新获取')
    }
    if (page.statusCode !== 200) {
      throw new Error(`文档页请求失败（${page.statusCode}），请检查文档链接`)
    }
    // 页面内嵌 JSON 有明文和 URL 编码两种形态
    const matched = page.body.match(/doc%22%3A%7B%22id%22%3A(\d+)/) || page.body.match(/"doc":\{"id":(\d+)/)
    if (!matched) {
      throw new Error('无法从文档页面解析出文档 ID，请确认链接是文档页且账号有访问权限')
    }
    return matched[1]
  }

  const handle = async (ctx) => {
    const userConfig = ctx.getConfig('picBed.yuque')
    if (!userConfig || !userConfig.cookie) {
      ctx.emit('notification', {
        title: '配置错误',
        body: '请先配置语雀 Cookie，获取方式见 README.md'
      })
      return ctx
    }
    if (!userConfig.docUrl) {
      ctx.emit('notification', {
        title: '配置错误',
        body: '请先配置语雀文档链接，获取方式见 README.md'
      })
      return ctx
    }
    const ctoken = extractCtoken(userConfig.cookie)
    if (!ctoken) {
      ctx.emit('notification', {
        title: '配置错误',
        body: 'Cookie 中缺少 yuque_ctoken，请复制完整的 Cookie'
      })
      return ctx
    }

    try {
      const docId = await resolveDocId(userConfig.docUrl, userConfig.cookie)
      const baseUrl = new URL(userConfig.docUrl).origin

      const imgList = ctx.output
      for (const img of imgList) {
        let image = img.buffer
        if (!image && img.base64Image) {
          image = Buffer.from(img.base64Image, 'base64')
        }

        if (!image) {
          ctx.emit('notification', {
            title: '上传失败',
            body: '未找到图片数据'
          })
          continue
        }

        const fileName = img.fileName || `image_${Date.now()}.png`
        const postConfig = postOptions(baseUrl, userConfig.cookie, docId, ctoken, image, fileName)
        const body = await ctx.Request.request(postConfig)

        let res
        try {
          res = JSON.parse(body)
        } catch {
          // 会话失效时接口返回登录页 HTML
          throw new Error('服务器返回了非预期的响应，Cookie 可能已失效')
        }
        if (res && res.data && res.data.url) {
          delete img.base64Image
          delete img.buffer
          img.imgUrl = res.data.url
        } else {
          throw new Error((res && res.message) || '服务器返回错误')
        }
      }
    } catch (e) {
      ctx.emit('notification', {
        title: '上传失败',
        body: e.message
      })
      throw e
    }
    return ctx
  }

  const config = ctx => {
    const userConfig = ctx.getConfig('picBed.yuque') || {}
    return [
      {
        name: 'cookie',
        type: 'input',
        default: userConfig.cookie,
        alias: '语雀 Cookie',
        required: true
      },
      {
        name: 'docUrl',
        type: 'input',
        default: userConfig.docUrl,
        alias: '文档链接',
        required: true
      }
    ]
  }

  return {
    uploader: 'yuque',
    register
  }
}
