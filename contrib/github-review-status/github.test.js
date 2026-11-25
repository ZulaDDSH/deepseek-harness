import assert from 'node:assert/strict'
import {test} from 'node:test'
import {auditRevision,parsePull,parseSnapshot} from './github.js'

const pull=parsePull('https://github.com/Example/project/pull/42')
const head='a'.repeat(40)
const base='b'.repeat(40)
const check=(conclusion,extra={})=>({__typename:'CheckRun',name:'build',status:'COMPLETED',conclusion,isRequired:true,
  detailsUrl:'https://github.com/example/project/actions/runs/12',...extra})
const commit=(oid,nodes,hasNextPage=false)=>({oid,statusCheckRollup:{contexts:{nodes,pageInfo:{hasNextPage}}}})
const pr=(nodes,extra={})=>({state:'OPEN',headRefOid:head,baseRefOid:base,mergeStateStatus:'CLEAN',
  commits:{nodes:[{commit:commit(head,nodes)}]},...extra})

test('only canonical PR URLs can be resolved',()=>{
  assert.equal(pull.key,'example/project')
  assert.equal(parsePull('https://github.com.example.org/Example/project/pull/42'),undefined)
  assert.equal(parsePull('https://github.com/Example/../pull/42'),undefined)
})

test('GitHub confirmation is required for readiness',()=>{
  assert.equal(parseSnapshot(pr([check('SUCCESS')]),pull).ci,'passed')
  assert.equal(parseSnapshot(pr([],{mergeStateStatus:'BLOCKED'}),pull).ci,'unverified')
  assert.equal(parseSnapshot(pr([check('SUCCESS')],{mergeStateStatus:'BLOCKED'}),pull).ci,'unverified')
  assert.equal(parseSnapshot(pr([],{commits:{nodes:[{commit:commit(head,[],true)}]}}),pull).ci,'unverified')
  assert.equal(parseSnapshot(pr([],{commits:{nodes:[{commit:commit(base,[check('SUCCESS')])}]}}),pull).ci,'unverified')
})

test('displays GitHub’s relevant check and prefers the test merge status',()=>{
  const result=parseSnapshot(pr([check('SUCCESS')],{potentialMergeCommit:commit('c'.repeat(40),[check('TIMED_OUT')])}),pull)
  assert.equal(result.ci,'failed')
  assert.equal(result.check.name,'build')
  assert.equal(result.url,'https://github.com/example/project/actions/runs/12')
  assert.equal(parseSnapshot(pr([check(null,{status:'IN_PROGRESS'})]),pull).ci,'pending')
  assert.equal(parseSnapshot(pr([check('FAILURE',{isRequired:false})]),pull).ci,'passed')
  assert.equal(parseSnapshot(pr([check('FAILURE',{detailsUrl:'https://untrusted.example/path'})]),pull).url,pull.url+'/checks')
})

test('stale or unknown revisions cannot inherit an earlier approval',()=>{
  const row={head,pull:{target:base}}
  assert.equal(auditRevision(row,{head,base}),'current')
  assert.equal(auditRevision(row,{head:'c'.repeat(40),base}),'changed')
  assert.equal(auditRevision(row,{head,base:'c'.repeat(40)}),'changed')
  assert.equal(auditRevision({head},{head,base}),'unverified')
  assert.equal(auditRevision(row,{}),'unverified')
})
