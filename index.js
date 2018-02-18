#!/usr/bin/env node

const program = require('commander');
const inquirer = require('inquirer');
const { exec } = require('child_process');
const AWS = require('aws-sdk');
const fs = require('fs');
const ini = require('ini');

const commaSplitter = (value) => value.split(',');

program
    .version('0.1.0')
    .option('-p, --profile <string>', 'Specify aws profile')
    .option('-f, --filters [string]', 'Result filters', commaSplitter)
    .parse(process.argv);

// TODO validate arguments

if (!program.profile || !program.filters) {

    const questions = [];

    if (!program.profile) {
        // TODO validate that there is a value and that it exists
        questions.push({
            type: 'input',
            name: 'profile',
            message: 'Which AWS profile would you like to use?'

        });
    }

    if (!program.filters) {
        // TODO validate
        questions.push({
            type: 'input',
            name: 'filters',
            message: 'Would you like to filter the results? (comma separate your keywords)'
        });
    }

    inquirer.prompt(questions).then((answers) => {

        if (answers.profile) {
            program.profile = answers.profile;
        }

        if (answers.filters) {
            program.filters = commaSplitter(answers.filters);
        }

        configure();
        query();
    });

} else {
    configure();
    query();
}


function query() {

    const ec2 = new AWS.EC2();

    ec2.describeInstances({}, (error, data) => {
        if (error) {

            if (error.code === 'RequestExpired' || error.code === 'UnauthorizedOperation') {
                queryForMfa();
            } else {
                console.log(error);
            }
        } else {
            const instances = data.Reservations.map((item) => {
                // TODO when is there more than one?
                const data = item.Instances[0].Tags
                                              .reduce((accumulator, item) => {
                                                  accumulator[item.Key] = item.Value;
                                                  return accumulator;
                                              }, {});

                data.instanceId = item.Instances[0].InstanceId;

                if (item.Instances[0].NetworkInterfaces[0]) {
                    data.privateIp = item.Instances[0].NetworkInterfaces[0].PrivateIpAddress;
                }

                if (item.Instances[0].PublicIpAddress) {
                    data.publicIp = item.Instances[0].PublicIpAddress;
                }

                return data;
            });

            processResults(instances);
        }
    });
}

function queryForMfa() {
    exec('aws ec2 describe-instances --profile ' + program.profile, (err, stdout, stderr) => {
        if (err) {
            console.log(err);
            return;
        }

        if (stdout) {
            configure();
            query();
        } else if (stderr) {
            console.log(stderr);
        } else {
            console.log('How did we get here, no stdout and no stderr');
        }
    });
}

function processResults(instances) {

    const processedInstances = instances
        .sort((a, b) => {

            if (!a['Name']) {
                return 1;
            } else if (!b['Name']) {
                return -1;
            }

            return a['Name'].localeCompare(b['Name'])
        })
        .filter((instance) => {

            if (!program.filters) {
                return true;
            }

            const result = program.filters.filter((filter) => {
                return Object.values(instance).find((field) => {
                    return field.search(filter) > -1;
                });
            });

            return result.length === program.filters.length;
        })
        .map((instance) => {

            const serializedFields = Object.keys(instance)
                                           .filter((item) => {
                                               // already used as the "key"
                                               return item !== 'instanceId'
                                           })
                                           .sort((a, b) => {
                                               return a.localeCompare(b);
                                           })
                                           .reduce((accumulator, item) => {
                                               let separator = '';
                                               if (accumulator) {
                                                   separator = ', ';
                                               }
                                               return accumulator + separator + item + ':' + instance[item];
                                           }, '');

            return {
                name: instance.instanceId + ' [' + serializedFields + ']',
                short: instance.instanceId,
                value: instance.instanceId
            };
        });

    if (processedInstances.length === 0) {
        console.log('Your query did not yield any results.');
    } else {
        inquirer.prompt([{
            type: 'checkbox',
            name: 'servers',
            message: 'Select server(s)',
            choices: processedInstances
        }]).then((answers) => {
            console.log(answers.servers)
        });
    }
}

function setCredentials() {
    const configIni = ini.parse(fs.readFileSync(`${process.env.HOME}/.aws/config`, 'utf-8'));
    const awsProfileConfig = configIni[`profile ${program.profile}`];
    if (awsProfileConfig && awsProfileConfig.role_arn) {
        const roleArn = awsProfileConfig.role_arn.replace(/:/g, '_').replace(/[^A-Za-z0-9\-_]/g, '-');
        const awsCliCacheFilename = `${program.profile}--${roleArn}`;

        try {
            const awsCliCache = JSON.parse(fs.readFileSync(`${process.env.HOME}/.aws/cli/cache/${awsCliCacheFilename}.json`, 'utf-8'));
            const sts = new AWS.STS();
            AWS.config.credentials = sts.credentialsFrom(awsCliCache, awsCliCache);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // we do not do anything. the later code of AWS will throw a proper error to require re-authentication
            } else {
                throw error;
            }
        }
    }
}

function configure() {
    AWS.config.region = 'eu-west-1';
    AWS.config.apiVersions = {
        ec2: '2016-11-15'
    };

    setCredentials();
}