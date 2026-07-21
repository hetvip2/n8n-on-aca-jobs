@description('Azure location for the sample ACA Job resources.')
param location string = resourceGroup().location

@description('Name prefix used for resources.')
@minLength(3)
param namePrefix string = 'n8naca'

@description('Container image used by the sample manual ACA Job.')
param acaJobImage string = 'mcr.microsoft.com/k8se/quickstart-jobs:latest'

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var workspaceName = '${namePrefix}-law-${suffix}'
var managedEnvironmentName = '${namePrefix}-env-${suffix}'
var jobName = '${namePrefix}-job-${suffix}'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource acaJob 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  properties: {
    environmentId: managedEnvironment.id
    configuration: {
      triggerType: 'Manual'
      replicaRetryLimit: 1
      replicaTimeout: 1800
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: acaJobImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

output ACA_JOB_NAME string = acaJob.name
output ACA_JOB_RESOURCE_GROUP string = resourceGroup().name
output ACA_JOB_RESOURCE_ID string = acaJob.id
output AZURE_SUBSCRIPTION_ID string = subscription().subscriptionId