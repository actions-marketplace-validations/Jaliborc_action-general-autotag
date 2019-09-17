const github = require('@actions/github')
const core = require('@actions/core')
const path = require('path')
const fs = require('fs')

async function run() {
  try {
    let fileName = core.getInput('source_file')
    let filePath = path.join(process.env.GITHUB_WORKSPACE, fileName)
    if (!fs.existsSync(filePath))
      return core.setFailed(`source file ${fileName} does not exist.`)

    let content = fs.readFileSync(filePath)
    let regex = new RegExp(core.getInput('extraction_regex'))
    let matches = String(content).match(regex)
    if (!matches)
      return core.setFailed(`no match was found for the regex '${regex.toString()}'.`)

    let version = matches[matches.length - 1]
    let format = core.getInput('tag_format', { required: false }).trim()
    let message = core.getInput('tag_message', { required: false }).trim()
    let name = format.replace('{version}', version)
    
    core.setOutput('version', version)
    core.setOutput('tagname', name)

    if (!process.env.hasOwnProperty('INPUT_GITHUB_TOKEN') || process.env.INPUT_GITHUB_TOKEN.trim().length === 0)
      return core.setFailed('Invalid or missing GITHUB_TOKEN.')
      
    let git = new github.GitHub(process.env.INPUT_GITHUB_TOKEN)
    let repoID = process.env.GITHUB_REPOSITORY.split('/')
    let owner = repoID[0], repo = repoID[1]

    let tags
    try {
      tags = await git.repos.listTags({owner, repo, per_page: 100})
    } catch (e) {
      core.warning('No tags were listed')
    }

    if (tags) {
      for (let tag of tags.data)
        if (tag.name.trim().toLowerCase() === name.trim().toLowerCase())
          return core.warning(`"${tag.name.trim()}" tag already exists.`)

      if (message.length === 0 && tags.data.length > 0) {
        try {
          let latest = tags.data.shift()
          let changelog = await git.repos.compareCommits({owner, repo, base: latest.name, head: 'master'})

          message = changelog.data.commits.map(commit => commit ? `\n1) ${commit.commit.message} ${commit.hasOwnProperty('author') ? (commit.author.hasOwnProperty('login') ? ' (' + commit.author.login + ')' : '') : ''}` : '')
            .join('\n').trim()
        } catch (e) {
          return core.setFailed(e.message)
        }
      }
    }

    let tag
    try {
      core.debug('Making tag...')
      message = message.length > 0 ? message : 'Initial tag'
      tag = await git.git.createTag({owner, repo, tag: name, message: message, object: process.env.GITHUB_SHA, type: 'commit'})
      core.warning(`Created tag ${tag.data.sha}`)
    } catch (e) {
      return core.setFailed(e.message)
    }

    let reference
    try {
      core.debug('Making reference...')
      reference = await git.git.createRef({owner, repo, ref: `refs/tags/${tag.data.tag}`, sha: tag.data.sha})
      core.warning(`Reference ${reference.data.ref} available at ${reference.data.url}`)
    } catch (e) {
      return core.setFailed(e.message)
    }

    if (typeof tag === 'object' && typeof reference === 'object') {
      core.setOutput('tagsha', tag.data.sha)
      core.setOutput('taguri', reference.data.url)
      core.setOutput('tagmessage', message)
    }
  } catch (error) {
    core.warning(error.message)
  }
}

run()
