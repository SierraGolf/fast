#!/usr/bin/env node

const program = require('commander');
const inquirer = require('inquirer');
const { exec } = require('child_process');
const AWS = require('aws-sdk');
const fs = require('fs');
const ini = require('ini');

program
    .version('0.1.0')
    .option('-p, --profile <string>', 'Specify aws profile')
    .option('-f, --filters [string]', 'Result filters', (value) => value.split(','))
    .parse(process.argv);


if (!program.profile) {

    inquirer.prompt([{
        type: 'input',
        name: 'profile',
        message: 'Which AWS profile would you like to use?'

    }]).then((answers) => {
        program.profile = answers.profile;
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
                const privateIp = item.Instances[0].NetworkInterfaces[0].PrivateIpAddress;
                const tags = item.Instances[0].Tags
                                              .reduce((accumulator, item) => {
                                                  accumulator[item.Key] = item.Value;
                                                  return accumulator;
                                              }, {});

                return {
                    privateIp: privateIp,
                    tags: tags
                };
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
    instances
        .sort((a, b) => {

            if (!a.tags['Name']) {
                return 1;
            } else if (!b.tags['Name']) {
                return -1;
            }

            return a.tags['Name'].localeCompare(b.tags['Name'])
        })
        .filter((instance) => {

            if (!program.filters) {
                return true;
            }

            const result = program.filters.filter((filter) => {
                return Object.values(instance.tags).find((tag) => {
                    return tag.search(filter) > -1;
                });
            });

            return result.length === program.filters.length;
        })
        .forEach((instance) => {

            const serializedTags = Object.keys(instance.tags)
                                         .sort((a, b) => {
                                             return a.localeCompare(b);
                                         })
                                         .reduce((accumulator, item) => {
                                             return accumulator + item + ':' + instance.tags[item] + ', ';
                                         }, '');

            console.log(instance.privateIp + ', ' + serializedTags);
        });
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