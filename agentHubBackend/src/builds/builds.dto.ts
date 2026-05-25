import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

export class BuildVersionDto {
  @IsOptional()
  @IsString()
  versionId?: string

  @IsOptional()
  @IsBoolean()
  skipDocker?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(200)
  installCommand?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  buildCommand?: string
}
